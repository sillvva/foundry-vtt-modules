class SuiteHooks extends Hooks {
    
    // Give hooks an initial value and some data and allow modifications to that value
    // Use case: hooking 3rd-party macro parsing extensions
    
    static callAllValues(hook, initial, ...args) {
        if (!hooks.hasOwnProperty(hook)) return initial;
        console.log(`${vtt} | Called ${hook} hook`);
        return hooks[hook].reduce((final, fn) => fn(final, ...args) || final, initial) || initial;
    }
}

class SuiteDialog extends Dialog {
    constructor(data, options) {
        super(data, options);
    }

    // The following changes were made to allow handling when dialog is closed by any means
    // Use case: Prompt macros would otherwise crash script if closed without submission.

    _submit(button, html) {
        if (button.callback) button.callback(html);
        this.close(html, true);
    }
    
    close(html = this.element, submitted = false) {
        if (this.data.close) this.data.close(html, submitted);
        super.close();
    }
}

class Macros {
    constructor() {
        this.macros = [];
        this.actors = [];
        this.rollReferences = {};
        this.nested = [];

        // Register hooks
        this.hookReady();
        this.hookActor();
        this.hookSettings();
        this.hookChat();
    }

    /* -------------------------------------------- */

    // HOOKS

    /**
     * Hook into the ready call for the VTT application
     */
    hookReady() {
        Hooks.on('ready', () => {
            game.settings.register(game.data.system.name, "macros", {
                name: "Actor Macros",
                hint: "Actor macros for quick access to chat commands",
                default: "[]",
                type: String,
                onChange: macros => {
                    this.macros = JSON.parse(macros);
                    this.renderMacroBar();
                }
            });
            game.settings.register('core', "promptOptionsMemory", {
                name: "Prompt Options Memory",
                hint: "Memory of previously selected options",
                default: "{}",
                type: String,
                onChange: memory => {
                    this.optMemory = JSON.parse(memory);
                }
            });

            this.macros = JSON.parse(game.settings.get(game.data.system.name, "macros"));
            this.optMemory = JSON.parse(game.settings.get('core', 'promptOptionsMemory'));

            // Snapshot used to determine actor permissions after actor is deleted.
            // If actor is not owned, stored macros will be removed.
            this.actors = duplicate(game.actors.source);

            // Ensure existing macros actor ids match up with current worlds's actors with same name
            this._assignMacros();
        });
    }

    /* -------------------------------------------- */

    /**
     * Hook into the render call for the Actor
     */
    hookActor() {
        Hooks.on('createActor', actor => {
            this.actors = duplicate(game.actors.source);
        });

        Hooks.on('updateActor', actor => {
            this.actors = duplicate(game.actors.source);
            game.settings.set(game.data.system.name, 'macros', JSON.stringify(this.macros
                .map(macro => {
                    if (macro.actor.id === actor.data._id) {
                        macro.actor.name = actor.data.name;
                    }
                    return macro;
                }))
            );
        });

        Hooks.on('deleteActor', id => {
            this.actors.filter(a => a._id === id).forEach(a => {
                if (!Object.entries(a.permission).find(kv => kv[1] === 3)) {
                    game.settings.set(game.data.system.name, 'macros', JSON.stringify(this.macros.filter(m => m.actor.id !== id)));
                }
            });
            this.actors = duplicate(game.actors.source);
        });
    }

    /* -------------------------------------------- */

    /**
     * Hook into the Settings sidebar
     */
    hookSettings() {
        Hooks.on('renderSettings', (app, html, data) => {
            html.append('<h2>Macros</h2>');
            html.append('<button id="configure-world-macros"><i class="far fa-keyboard"></i> Configure World Macros</button>');
            html.append('<button id="configure-global-macros"><i class="far fa-keyboard"></i> Configure Global Macros</button>');

            $('#configure-world-macros').click((ev) => {
                ev.preventDefault();
                new MacroConfig({
                    world: game.data.world,
                    scope: 'world'
                }).render(true);
            });
            $('#configure-global-macros').click((ev) => {
                ev.preventDefault();
                new MacroConfig({
                    world: game.data.world,
                    scope: 'global'
                }).render(true);
            });
        });
    }

    /* -------------------------------------------- */

    /**
     * Hook into the Chat API
     */
    hookChat() {
        Hooks.on('chatMessage', (chatLog, message, chatData) => {
            const hasMacro = message.match(/\{\{[^\}]+\}\}|\#\{[^\}]+}|\[\[[^\]]+\]\]|\?\{[^\}]+\}|@\{[^\}]+\}/);
            if (hasMacro) {
                const cTokens = canvas.tokens.controlledTokens;
                if (cTokens.length === 1) {
                    var actor = game.actors.entities.find(a => a._id === cTokens[0].data.actorId);
                }
                this.parseToMessage(chatLog, { type: 'custom', content: message, label: 'Chat Message' }, actor);
                return false;
            }
        });
    }

    // SEND MESSAGE

    /**
     * Parse a macro and create chat entry in ChatLog
     * @param chatLog
     * @param content
     * @param actor
     */
    parseToMessage(chatLog, macro, actor) {
        this.nested.push(this._macroTag(macro.type, macro.label));
        this.parse(macro.content, actor, macro.content.indexOf('/(b(lind)?|gm)?r(oll)?') < 0).then(message => {
            this.nested = [];
            chatLog._processMessageData(message).then(chatData => {

            }).catch(error => {
                ui.notifications.error(error);
            });
        });
    }

    /**
     * Parse a rollable table and create chat entry in ChatLog
     * @param chatLog
     * @param macro
     * @param actor
     */
    rollTableToMessage(chatLog, macro, actor) {
        this.rollTable(macro.table).then(content => {
            content = `<strong>${macro.label}</strong><br />${content}`;
            macro.content = content;
            this.parseToMessage(chatLog, macro, actor);
        }).catch(error => {
            ui.notifications.error(error);
        });
    }

    // MACROS

    /**
     * Store macros in memory
     * @param macros
     */
    save(macros) {
        game.settings.set(game.data.system.name, 'macros', JSON.stringify(macros));
    }

    /**
     * Store macros in temporary memory
     * @param macros
     */
    set(macros) {
        this.macros = macros;
        this.renderMacroBar();
    }

    /* -------------------------------------------- */

    /**
     * Parse message content for custom macro syntax
     * @param content
     * @param actor
     * @param tooltips
     * @returns {Promise<any>}
     */
    async parse(content, actor, tooltips = false) {
        let message = duplicate(content);
        message = SuiteHooks.callAllValues('parseMacrosBegin', message, actor);
        let parsed = await this.parsePrompts(message);
        message = this.parsePromptOptionReferences(parsed.message, parsed.references);
        message = SuiteHooks.callAllValues('parseMacrosAfterPrompts', message, actor);
        message = await this.parseNested(message, actor, tooltips);
        message = this.parseRolls(message, tooltips);
        message = this.parseRollReferences(message);
        message = SuiteHooks.callAllValues('parseMacrosEnd', message, actor);
        return message;
    }

    /* -------------------------------------------- */

    // NESTED

    async parseNested(message, actor, tooltips) {
        const macros = {};
        const types = ['custom','table'];
        if (actor) {
            game.macros.macros
                .filter(macro => macro.actor && types.find(type => type === macro.type) && macro.actor.id === actor.id)
                .forEach(macro => {
                    const tag = this._macroTag(macro.type, macro.label);
                    if (!macros[tag] && !this.nested.find(n => n === tag)) {
                        macros[tag] = macro;
                    }
                });
        }
        game.macros.macros
            .filter(macro => macro.world && types.find(type => type === macro.type))
            .forEach(macro => {
                const tag = this._macroTag(macro.type, macro.label);
                if (!macros[tag] && !this.nested.find(n => n === tag)) {
                    macros[tag] = macro;
                }
            });
        game.macros.macros
            .filter(macro => macro.global && types.find(type => type === macro.type))
            .forEach(macro => {
                const tag = this._macroTag(macro.type, macro.label);
                if (!macros[tag] && !this.nested.find(n => n === tag)) {
                    macros[tag] = macro;
                }
            });
        const rgx = new RegExp(`\\#\\{(${types.join('|')})\\|([^\\}]+)\\}`, 'g');
        const m = message.match(rgx);
        if (m) {
            for(let match of m) {
                if (macros[match]) {
                    if (macros[match].type === 'custom') {
                        this.nested.push(match);
                        message = await this.parse(message.replace(match, macros[match].content), actor, tooltips);
                    } else if (macros[match].type === 'table') {
                        message = message.replace(match, await this.rollTable(macros[match].table));
                    }
                } else {
                    message = message.replace(match, '');
                }
            }
        }
        return message;
    }

    /* -------------------------------------------- */

    // TABLES

    async rollTable(table) {
        const max = table.reduce((total, entry) => total + entry.weight, 0);
        const roll = Math.floor(Math.random() * max) + 1;

        let total = 0;
        for (let i = 0; i < table.length; i++) {
            total += table[i].weight;
            if (roll <= total) {
                return table[i].value;
            }
        }

        throw new Error('Error in rollable table');
    }

    /* -------------------------------------------- */

    /**
     * Parses a message for input requests. Prompt tags with the same query will only prompt once and use the same value each additional time the query is requested.
     * @param message - message to parse
     * @returns {String} - parsed message
     *
     * @example <caption>Text input example</caption>
     * // default value is an empty string if omitted
     * ?{Query|default value (optional)}
     *
     * @example <caption>Dropdown example?</caption>
     * ?{Query|option 1 label,option 1 value|option 2 label,option 2 value|...}
     * ?{[list]Query|option 1 label,option 1 value|option 2 label,option 2 value|...}
     *
     * @example <caption>Radio button example</caption>
     * ?{[radio]Query|option 1 label,option 1 value|option 2 label,option 2 value|...}
     *
     * @example <caption>Checkbox examples</caption>
     * // Selected options will be printed out separated by the delimiter of choice (default ", ")
     * ?{[checkbox|delimiter]Query|option 1 label,option 1 value|option 2 label,option 2 value|...}
     *
     * // Selected options can be referenced additional times with the following.
     * // If option was not selected, this tag will be replaced with an empty string.
     * ?{:option 1 label}
     *
     * @example <caption>Repeating a query to get the same value multiple times</caption>
     * ?{Query} // prompts for a text input
     * ?{Query} // identical query retrieves original response
     */
    async parsePrompts(message, parsed = {}) {
        /*
        \?\{(?!:)
        (                                       //1
            \[(                                 //2     listType
                list|checkbox|radio
            )(                                  //3
                \|(                             //4     optionDelimiter
                    [^\]]*
                )?
            )?\]
        )?
        (                                       //5     query
            (                                   //6
                [^\|\{\}]                       //      Any non-separator, non-tag character
                |                               //      or
                \{\{[^\}]+\}\}                  //      An actor data tag, which uses the same tag characters
            )+
        )
        \|?
        (                                       //7     list
            (                                   //8
                (                               //9
                    [^,\{\}\|]
                    |
                    \{\{[^\}]+\}\}
                )+(                             //10
                    ,(                          //11
                        [^\|\{\}]
                        |
                        \{\{[^\}]+\}\}
                    )+
                )+\|?
            )+
        )?
        (                                       //12    defaultValue
            (                                   //13
                [^\{\}]
                |
                \{\{[^\}]+\}\}
            )+
        )?\}
        */
        const p = message.match(/\?\{(?!:)(\[(list|checkbox|radio)(\|([^\]]*)?)?\])?(([^\|\{\}]|\{\{[^\}]+\}\})+)\|?((([^,\{\}\|]|\{\{[^\}]+\}\})+(,([^\|\{\}]|\{\{[^\}]+\}\})+)+\|?)+)?(([^\{\}]|\{\{[^\}]+\}\})+)?\}/i);
        if (!p) {
            // No more prompt tags
            game.settings.set('core', 'promptOptionsMemory', JSON.stringify(this.optMemory));
            return {message: message, references: parsed};
        } else {
            // Prompt tag detected
            const tag = p[0];

            if (!this.optMemory[tag]) this.optMemory[tag] = {};
            
            // Important capturing groups
            const listType = p[2] || 'list';
            const optionDelimiter = p[3] ? (p[4] || '') : ', ';
            const query = p[5].trim();
            const list = p[7];
            const defaultValue = p[12];

            // List options detected
            if (list) {
                if (parsed[query]) {
                    // Use previous input for repeated queries and selected options
                    return await this.parsePrompts(message.replace(tag, parsed[query].join(optionDelimiter)), parsed);
                } else {
                    return await new Promise((resolve, reject) => {
                        let html = '<p>' + query + '</p>';
                        let inputTag = '';
                        if (listType === 'list') {
                            inputTag = '.list-prompt[query="' + query.replace(/"/g, '\\"') + '"]';

                            html += '<p><select class="list-prompt" query="' + query.replace(/"/g, '\\"') + '">';
                            list.split('|').forEach((listItem) => {
                                const parts = listItem.split(',');
                                const liLabel = parts[0].trim();
                                const selected = this.optMemory[tag].value === parts.slice(1).join(',').trim().replace(/"/g, '\\"');
                                const value = parts.slice(1).join(',').trim().replace(/"/g, '\\"');
                                html += '<option value="' + value + '" ' + (selected ? 'selected' : '') + '>' + parts[0].trim() + '</option>';
                            });
                            html += '</select></p>';
                        } else if (listType === 'checkbox' || listType === 'radio') {
                            inputTag = '.list-prompt';

                            html += '<form class="list-prompt">';
                            list.split('|').forEach((listItem) => {
                                const parts = listItem.split(',');
                                const liLabel = listType === 'checkbox' ? parts[0].trim().replace(/"/g, '\\"') : query;
                                const checked = this.optMemory[tag][liLabel] === parts.slice(1).join(',');
                                const value = parts.slice(1).join(',').trim().replace(/"/g, '\\"');
                                html += '<p><label><input type="' + listType + '" name="' + liLabel + '" value="' + value + '" ' + (checked ? 'checked' : '') + ' /> ' + parts[0].trim() + '</label></p>'
                            });
                            html += '</form>';
                        }

                        new SuiteDialog({
                            title: query,
                            content: html,
                            buttons: {
                                "ok": {
                                    icon: '',
                                    label: "OK",
                                    callback: () => {
                                        if (listType === 'list') {
                                            const inputLabel = $(inputTag + ' option:selected').html();
                                            const inputValue = $(inputTag + ' option:selected').val();
                                            this.optMemory[tag].value = inputValue;
                                            parsed[inputLabel] = inputValue.split(',');
                                            parsed[query] = [inputValue.split(',')[0]];
                                            resolve(this.parsePrompts(message.replace(tag, inputValue.split(',')[0]), parsed));
                                        } else if (listType === 'checkbox' || listType === 'radio') {
                                            const selected = [];
                                            list.split('|').forEach((listItem) => {
                                                const parts = listItem.split(',');
                                                const liLabel = listType === 'checkbox' ? parts[0].trim().replace(/"/g, '\\"') : query;
                                                if (listType === 'checkbox') delete this.optMemory[tag][liLabel];
                                            });
                                            $(inputTag).serializeArray().forEach(item => {
                                                selected.push(item.value.split(',')[0]);
                                                parsed[item.name] = item.value.split(',');
                                                this.optMemory[tag][item.name] = item.value;
                                            });
                                            const input = selected.join(optionDelimiter);
                                            parsed[query] = [input];
                                            resolve(this.parsePrompts(message.replace(tag, input), parsed));
                                        }
                                    }
                                }
                            },
                            close: (html, submitted) => {
                                if (submitted) return;
                                parsed[query] = [''];
                                resolve(this.parsePrompts(message.replace(tag, ''), parsed));
                            }
                        }).render(true);
                    }, {
                        width: 400
                    });
                }
            } else {
                const input = parsed[query] || prompt(query, defaultValue != null ? defaultValue.trim() : '');
                parsed[query] = [input];
                return await this.parsePrompts(message.replace(tag, input || ''), parsed);
            }
        }
    }

    /* -------------------------------------------- */

    /**
     * Parse references to selected prompt options
     * @param message
     * @param parsed
     * @returns {String} - parsed message
     */
    parsePromptOptionReferences(message, parsed) {
        /*
        \?\{:(                      //1 query
            [^\|\}]+
        )\|?(                       //2
            (                       //3 defaultValue
                [^\{\}]
                |
                \{\{[^\}]+\}\}
            )+
        )?\}
        */
        const p = message.match(/\?\{:([^\|\}]+)\|?(([^\{\}]|\{\{[^\}]+\}\})+)?\}/i);
        if (!p) {
            return message;
        } else {
            const tag = p[0];
            const query = p[1].trim();
            const defaultValue = p[3] || '1';

            if (parsed[query]) {
                // Use previous input for repeated queries and selected options
                let defaultParsed = 0;
                if (!isNaN(parseInt(defaultValue) || '1')) {
                    defaultParsed = parseInt(defaultValue) - 1;
                }
                return this.parsePromptOptionReferences(message.replace(tag, parsed[query][defaultParsed]), parsed);
            } else {
                // This is a reference to a selection option, but the option was not selected. Replace with an empty string.
                return this.parsePromptOptionReferences(message.replace(tag, ''), parsed);
            }
        }
    }

    /* -------------------------------------------- */

    /**
     * Parses the chat message of dice and math
     * @returns {string} - Returns a parsed chat message
     */
    parseRolls(message, tooltips = false) {
        // create message nodes we can parse through
        // and preserve html
        let output = '<message>' + message
                .replace(/</g,'_--')
                .replace(/>/g,'--_')
                .replace(/\[\[/g, '<roll>')
                .replace(/\]\]/g, '</roll>')
            + '</message>';

        // parse the nodes
        let messageEl = $(output).get(0);
        output = messageEl.childNodes.length === 0 ?
            messageEl.innerHTML :
            this._parseRolls(messageEl, messageEl.nodeName, tooltips);

        // restore the html code to its original state
        return output
            .replace(/_--/g,'<')
            .replace(/--_/g,'>');
    }

    /* -------------------------------------------- */

    /**
     * Converts the parsed xml back into original syntax
     * @param html
     * @returns {string}
     * @private
     */
    static _reverseParseRolls(html) {
        return html
            .replace(/\<roll\>/g, '[[')
            .replace(/\<\/roll\>/g, ']]');
    }

    /* -------------------------------------------- */

    /**
     * Parses the XML nodes created by the parseRolls() method.
     * @param {Object} xml - A DOM node to be parsed
     * @param {String} nodeName - Name of the origin node being parsed
     * @returns {String} - the parsed chat message
     * @private
     */
    _parseRolls(xml, nodeName, tooltips) {
        const idRgx = /^(@([^:]+):)/i;
        if (xml.childNodes.length === 1 ? (xml.childNodes[0].nodeName === '#text') : false) {
            const m = xml.innerHTML.match(idRgx);
            return this._interpretNode(xml.innerHTML.replace(idRgx, ''), nodeName, m ? m[2] : Object.keys(this).length);
        } else if (xml.childNodes.length === 0) {
            const m = xml.nodeValue.match(idRgx);
            return this._interpretNode(xml.nodeValue.replace(idRgx, '') || '', nodeName, m ? m[2] : Object.keys(this).length);
        } else {
            let out = '';
            let outVal = '';
            xml.childNodes.forEach((node) => {
                const childNodeName = $(node).get(0).nodeName.toLowerCase();
                const add = this._parseRolls($(node).get(0), childNodeName);
                if (nodeName.toLowerCase() === 'message') {
                    if (childNodeName === '#text') {
                        outVal += add;
                    } else {
                        const parseString = this.constructor._reverseParseRolls('<' + childNodeName + '>' + $(node).get(0).innerHTML + '</' + childNodeName + '>');
                        if (xml.innerHTML.substr(0, 1) !== '/' && tooltips) {
                            outVal += '<span title="' + parseString.replace(/\[\[|\]\]/g, "").replace(/"/g, '\\"') + '">' + add + '</span>';
                        } else {
                            outVal += add;
                        }
                    }
                }
                out += add;
            });

            if (nodeName.toLowerCase() === 'message') return outVal;

            return this._parseRolls($('<' + nodeName + '>' + out + '</' + nodeName + '>').get(0), nodeName);
        }
    }

    /* -------------------------------------------- */

    /**
     * Interprets the node as either math or a dice string
     * @param value - node value
     * @param name - node name
     * @returns {String} - parsed node value
     * @private
     */
    _interpretNode(value, name, id = Object.keys(this).length) {
        if (value.length === 0) return value;
        if (name.toLowerCase() === 'roll') {
            const r = new Roll(value, {}).roll();
            const indDie = [];
            const mathString = r.parts.reduce((whole, part) => {
                if (part instanceof Die) {
                    indDie.push({sides: part.nsides, total: part.total});
                    return whole + part.total;
                } else {
                    return whole + part;
                }
            }, '');
            const result = math.eval(mathString);
            this.rollReferences[id + '_ref'] = {
                result: result,
                roll: r,
                rolls: indDie
            };
            return result;
        }
        return value;
    }

    /* -------------------------------------------- */

    /**
     * Parse references to named rolls
     * @param message
     * @param parser
     * @returns {String} - parsed message
     */
    parseRollReferences(message) {
        /*
        @\{(                        //1 id
            [^\|\}]+
        )(                          //2
            \|(                     //3 print
                [^\|\}]+
            )
        )?(                         //4
            \|(                     //5 options
                (                   //6
                    [^\|\}]+\|?
                )+
            )
        )?\}
        */
        const rolls = Object.keys(this.rollReferences).filter(key => key.indexOf('_ref') >= 0);
        const m = message.match(/@\{([^\|\}]+)(\|([^\|\}]+))?(\|(([^\|\}]+(\|)?)+))?\}/i);
        if (!m) {
            return message;
        } else {
            const id = m[1];
            const print = m[3] || 'result';
            const options = (m[5] || '').split('|');

            // console.log(id, print, options);

            if (id.length > 0) {
                const rollKey = rolls.find(key => id + '_ref');
                if (rollKey) {
                    const roll = duplicate(this.rollReferences[id + '_ref']);
                    if (print.trim() === 'result') {
                        message = message.replace(m[0], roll.result);
                    } else if (print.trim() === 'crit') {
                        if (options.length === 2 && !isNaN(parseInt(options[0]))) {
                            const die = roll.rolls[parseInt(options[0]) - 1];
                            let critRange = die.sides;
                            if (!isNaN(parseInt(options[1]))) {
                                critRange = parseInt(options[1]);
                            }
                            if (die ? die.total >= critRange : false) {
                                message = message.replace(m[0], print);
                            } else {
                                message = message.replace(m[0], '');
                            }
                        } else {
                            message = message.replace(m[0], '');
                        }
                    } else if (print.trim() === 'fumble') {
                        if (options.length === 1 && !isNaN(parseInt(options[0]))) {
                            const die = roll.rolls[parseInt(options[0]) - 1];
                            if (die ? die.total === 1 : false) {
                                message = message.replace(m[0], print);
                            } else {
                                message = message.replace(m[0], '');
                            }
                        } else {
                            message = message.replace(m[0], '');
                        }
                    } else {
                        message = message.replace(m[0], '');
                    }
                }
            }

            return this.parseRollReferences(message);
        }
    }

    /* -------------------------------------------- */

    // MACRO BAR

    /**
     * Render the macro bar
     */
    renderMacroBar() {
        // Ensure existing macros actor ids match up with current worlds's actors with same name
        this._assignMacros(false);

        new MacroBar().render(true);
    }

    /* -------------------------------------------- */

    _macroTag(type, label) {
        return `#{${type}|${label.replace(/[^a-z0-9 \-_]/gi, '').replace(/ /g, '-').toLowerCase()}}`;
    }

    /* -------------------------------------------- */

    // CLEANING

    /**
     * Ensure existing macros actor ids match up with current worlds's actors with same name
     */
    _assignMacros(store = true) {
        this.macros = this.macros.filter(macro => macro.label).map((macro, mid) => {
            if (macro.actor) {
                game.actors.source
                    .filter(a => a.name === macro.actor.name && a._id !== macro.actor.id)
                    .forEach(a => {
                        if (game.user.isGM || Object.keys(a.permission).find(p => p[0] === game.user.data._id && p[1] === 3)) {
                            macro.actor.id = a._id;
                        }
                    });
            }
            macro.mid = mid;
            return macro;
        });
        if (store) {
            this.save(this.macros);
        }
    }
}

/**
 * A macro configuration application
 * @type {Application}
 *
 */
class MacroConfig extends Application {
    constructor(data, options) {
        super();
        this.data = {
            windowId: data.windowId || Math.floor(Math.random() * 100000000),
            scope: data.scope || 'global',
            system: game.data.system.name,
            tabs: []
        };

        this.data[data.scope] = data[data.scope];

        this.options = Object.assign(this.constructor.defaultOptions, options || {}, {
            id: data.scope+'-macro-config'
        }, {
            insertKeys: true,
            insertValues: false,
            overwrite: true,
            inplace: false
        });

        this.addCustomTab();
        this.addTablesTab();

        Hooks.callAll('preRenderMacroConfig', this, this.getData());
    }

    /* -------------------------------------------- */

    /**
     * Assign the default options which are supported by this Application
     */
    static get defaultOptions() {
        const options = super.defaultOptions;
        options.title = "Macro Configuration";
        options.template = CONFIG.Macros.templatePath+CONFIG.Macros.templates.macroConfig;
        options.width = 800;
        return options;
    }

    /* -------------------------------------------- */

    getData() {
        return this.data;
    }

    /* -------------------------------------------- */

    /**
     * Add tab for custom macros
     */
    addCustomTab() {
        const existingMacros = game.macros.macros
            .filter(macro => {
                if (macro.type !== 'custom') return false;
                if (this.data.scope === 'actor' && macro.actor) return macro.actor.name === this.data.actor.data.name;
                if (this.data.scope === 'world' && macro.world) return macro.world.name === this.data.world.name;
                if (this.data.scope === 'global' && macro.global) return true;
                return false;
            })
            .reduce((output, macro) => {
                const inbar = macro.inbar === 'Y' || macro.inbar == null ? 'checked' : '';
                output += `<div class="macro custom">
                    <div class="macro-list">
                        <div class="macro-list-name">
                            ${macro.label}
                        </div>
                        <label>
                            <input type="checkbox" name="inbar" ${inbar}>
                            In Bar
                        </label>
                        <a class="macro-list-btn fas fa-edit"></a>
                        <a class="macro-list-btn fas fa-times"></a>
                    </div>
                    <div class="macro-edit hide">
                        <div class="macro-label">
                            <input type="text" name="label" value="${macro.label}" placeholder="Macro Name" data-type="String" />
                        </div>
                        <div class="macro-tag">Macro Tag: ${game.macros._macroTag('custom', macro.label)}</div>
                        <div class="macro-color">
                            <input type="color" name="color" value="${macro.color || '#ffffff'}" />
                        </div>
                        <div class="macro-content">
                            <textarea name="content" rows="8">${macro.content}</textarea>
                        </div>
                    </div>
                </div>`;
                return output;
            }, '');

        let actionButtons = '<button class="new-custom-macro" role="button"><span class="fa fa-plus"></span> Add Macro</button>';
        if (this.data.scope === 'actor') {
            actionButtons += '<button class="import-xml" role="button"><span class="fa fa-upload"></span> Import XML</button>';
            actionButtons += '<button class="export-xml" role="button"><span class="fa fa-download"></span> Export XML</button>';
        }

        const tab = {
            tabId: 'custom',
            tabName: 'Custom',
            html: `
                <div class="macro-action-bar">${actionButtons}</div>
                <div class="macros">${existingMacros}</div>`,
        };

        tab.onLoad = (html) => {
            html.find('.new-custom-macro').off('click').on('click', (ev) => {
                ev.preventDefault();
                html.find('.macros').append(this.constructor._customMacroTemplate);
                html.find('.macro').each((i, el) => {
                    this._customMacroEventListeners($(el));
                });
            });

            html.find('.export-xml').off('click').on('click', (ev) => {
                ev.preventDefault();
                const xml = $('<macros></macros>');

                game.macros.macros
                    .filter(m => m.actor && m.type === 'custom')
                    .filter(m => m.actor.id === this.data.actor.id)
                    .forEach(m => {
                        const macro = $('<macro></macro>');
                        macro.append($('<name></name>').append(m.label));
                        macro.append($('<color></color>').append(m.color || '#ffffff'));
                        macro.append($('<inbar></inbar>').append(m.inbar || 'Y'));
                        macro.append($('<content></content>').append(m.content));
                        xml.append(macro);
                    });

                const formattedXML = this.formatFactory(xml.clone().wrap('<div>').parent().html());
                this.exportMacrosXML(formattedXML);

                return false;
            });

            html.find('.import-xml').off('click').on('click', (ev) => {
                ev.preventDefault();

                const input = $('<input type="file" accept="application/xml" class="file-import hide" />');
                html.find('.file-import').remove();
                html.append(input);
                input.change((e) => {
                    for (let i = 0; i < e.target.files.length; i++) {
                        const file = e.target.files[i];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                this.readMacroXML(e.target.result);
                                html.find('.file-import').remove();
                            };
                            reader.readAsText(file);
                        }
                    }
                }).click();

                return false;
            });

            html.find('.macro').each((i, el) => {
                this._customMacroEventListeners($(el));
            });
        };

        tab.onSave = (html, macros) => {
            const macroEntries = html.find('.macro.custom');
            for(let i = 0; i < macroEntries.length; i++) {
                let label = $(macroEntries[i]).find('[name="label"]').val();
                let color = $(macroEntries[i]).find('[name="color"]').val();
                let inbar = $(macroEntries[i]).find('[name="inbar"]').prop('checked') ? 'Y' : 'N';
                let content = $(macroEntries[i]).find('[name="content"]').val();
                if (label.length === 0) continue;

                let data = {
                    mid: macros.length,
                    cid: i,
                    type: 'custom',
                    label: label,
                    color: color,
                    inbar: inbar,
                    content: content
                };

                if(this.data.scope === 'actor') {
                    data.actor = { id: this.data.actor._id, name: this.data.actor.data.name };
                } else if (this.data.scope === 'world') {
                    data.world = { name: this.data.world.name };
                } else {
                    data.global = true;
                }

                macros.push(data);
            }
            return macros;
        };

        this.addTab(tab);
    }

    /* -------------------------------------------- */

    /**
     * Add tab for rollable tables
     */
    addTablesTab() {
        const existingMacros = game.macros.macros
            .filter(macro => {
                if (macro.type !== 'table') return false;
                if (this.data.scope === 'actor' && macro.actor) return macro.actor.name === this.data.actor.data.name;
                if (this.data.scope === 'world' && macro.world) return macro.world.name === this.data.world.name;
                if (this.data.scope === 'global' && macro.global) return true;
                return false;
            })
            .reduce((output, macro) => output + this._table(macro), '');

        let actionButtons = '<button class="new-rollable-table" role="button"><span class="fa fa-plus"></span> Add Table</button>';
        /*if (this.data.scope === 'actor') {
            actionButtons += '<button class="import-xml" role="button"><span class="fa fa-upload"></span> Import XML</button>';
            actionButtons += '<button class="export-xml" role="button"><span class="fa fa-download"></span> Export XML</button>';
        }*/

        const tab = {
            tabId: 'table',
            tabName: 'Rollable Tables',
            flex: 2,
            html: `
                <div class="macro-action-bar">${actionButtons}</div>
                <div class="macros">${existingMacros}</div>`,
        };

        tab.onLoad = (html) => {
            html.find('.new-rollable-table').off('click').on('click', (ev) => {
                ev.preventDefault();

                const macro = {
                    label: 'Unnamed Table',
                    inbar: 'Y',
                    color: '#ffffff',
                    table: [
                        { weight: '', value: '' }
                    ]
                };

                html.find('.macros').append(this._table(macro));

                html.find('.macro').each((i, el) => {
                    this._rollableTableEventListeners($(el));
                });
            });

            html.find('.macro').each((i, el) => {
                this._rollableTableEventListeners($(el));
            });
        };

        tab.onSave = (html, macros) => {
            const macroEntries = html.find('.macro.rollable-table');
            for(let i = 0; i < macroEntries.length; i++) {
                let label = $(macroEntries[i]).find('[name="label"]').val();
                let color = $(macroEntries[i]).find('[name="color"]').val();
                let inbar = $(macroEntries[i]).find('[name="inbar"]').prop('checked') ? 'Y' : 'N';
                const tableEntries = $(macroEntries[i]).find('.macro-table');
                if (label.length === 0) continue;
                if (tableEntries.length === 0) continue;

                let data = {
                    mid: macros.length,
                    tid: i,
                    type: 'table',
                    label: label,
                    color: color,
                    inbar: inbar,
                    table: []
                };

                for(let t = 0; t < tableEntries.length; t++) {
                     const weight = parseInt($(tableEntries[t]).find('[name="weight"]').val());
                     const value = $(tableEntries[t]).find('[name="value"]').val();
                     data.table.push({ weight: isNaN(weight) ? 1 : weight, value: value });
                }

                if(this.data.scope === 'actor') {
                    data.actor = { id: this.data.actor._id, name: this.data.actor.data.name };
                } else if (this.data.scope === 'world') {
                    data.world = { name: this.data.world.name };
                } else {
                    data.global = true;
                }

                macros.push(data);
            }

            return macros;
        };

        this.addTab(tab);
    }

    _table(macro) {
        const inbar = macro.inbar === 'Y' || macro.inbar == null ? 'checked' : '';
        return `<div class="macro rollable-table">
            <div class="macro-list">
                <div class="macro-list-name">
                    ${macro.label}
                </div>
                <label>
                    <input type="checkbox" name="inbar" ${inbar}>
                    In Bar
                </label>
                <a class="macro-list-btn fas fa-edit"></a>
                <a class="macro-list-btn fas fa-times"></a>
            </div>
            <div class="macro-edit hide">
                <div class="macro-label">
                    <input type="text" name="label" value="${macro.label}" placeholder="Table Name" />
                </div>
                <div class="macro-tag">Macro Tag: ${game.macros._macroTag('table', macro.label)}</div>
                <div class="macro-color">
                    <input type="color" name="color" value="${macro.color || '#ffffff'}" />
                </div>
                <div class="macro-table-entries">
                    `+macro.table.reduce((table, entry) => {
                        return `${table} ${this._tableEntry(entry.weight, entry.value)}`;
                    }, '')+`
                </div>
                <div>
                    <button class="add-table-entry">Add Entry</button>
                </div>
            </div>
        </div>`;
    }

    _tableEntry(weight, value) {
        return `<div class="macro-table">
            <div class="macro-table-weight">
                <input type="number" name="weight" value="${weight}" placeholder="Weight" />
            </div>
            <div class="macro-table-value">
                <textarea name="value" rows="3" placeholder="Value">${value}</textarea>
            </div>
            <a class="table-entry-btn fas fa-times"></a>
        </div>`;
    }

    /* -------------------------------------------- */

    setTabs(numTabs) {
        let tabs = '';

        for (let i = 0; i < numTabs; i++){
            tabs += '    ';
        }
        return tabs;
    };

    formatHTML(html, numTabs = 0) {
        html = $.parseHTML(html);
        let formatted = '';

        $.each( html, ( i, el ) => {
            if (el.nodeName === '#text') {
                if (($(el).text().trim()).length) {
                    formatted += this.setTabs(numTabs) + $(el).text().trim() + '\n';
                }
            } else {
                let innerHTML = $(el).html().trim();
                $(el).html(innerHTML.replace('\n', '').replace(/ +(?= )/g, ''));

                if ($(el).children().length) {
                    $(el).html('\n' + this.formatHTML(innerHTML, (numTabs + 1)) + this.setTabs(numTabs));
                    let outerHTML = $(el).prop('outerHTML').trim();
                    formatted += this.setTabs(numTabs) + outerHTML + '\n';

                } else {
                    let outerHTML = $(el).prop('outerHTML').trim();
                    formatted += this.setTabs(numTabs) + outerHTML + '\n';
                }
            }
        });

        return formatted;
    };

    formatFactory(html) {
        return this.formatHTML(html.replace(/(\r\n|\n|\r)/gm,"\n").replace(/ +(?= )/g,''));
    }

    readMacroXML(macroXML) {
        const macros = $(macroXML).find('macro').toArray();
        let mid = 0;
        let cid = 0;
        const gMacros = duplicate(game.macros.macros)
            .filter(m => m.actor ? !(m.actor.id === this.data.actor.id && m.type === 'custom') : true)
            .map(m => {
                m.mid = mid;
                mid++;
                if (m.cid) {
                    m.cid = cid;
                    cid++;
                }
                return m;
            });

        macros.forEach((macro, i) => {
            let label = '', color = '#ffffff', inbar = 'Y', content = '';
            if (!$(macro).find('name')) { ui.notifications.error(`Macro #${i+1} has no name`); return; }

            label = $(macro).find('name').text();
            if ($(macro).find('color')) color = $(macro).find('color').text();
            if ($(macro).find('inbar')) inbar = $(macro).find('inbar').text();
            content = $(macro).find('content').html().trim().replace(/(\r\n|\r|\n)(    ){3}/g, "\n");

            gMacros.push({
                mid: mid,
                cid: cid,
                actor: { id: this.data.actor.id, name: this.data.actor.data.name },
                type: 'custom',
                label: label,
                color: color,
                inbar: inbar,
                content: content
            });

            cid++;
            mid++;
        });

        game.macros.save(gMacros);

        // Refresh the config window with the new data
        new MacroConfig({
            scope: 'actor',
            actor: this.data.actor
        }, {
            width: 650
        }).render(true);
    }

    /* -------------------------------------------- */

    // IMPORT/EXPORT

    /**
     * Export macros as XML
     * @param actor
     */
    exportMacrosXML(xml) {
        const blob = new Blob([xml], { type: "text/xml;charset=utf-8" });
        const fileURL = URL.createObjectURL(blob);
        const win = window.open();
        const element = win.document.createElement('a');
        $(element)
            .attr('href', fileURL)
            .attr('download', this.data.actor.data.name.replace(/[^_\-a-z0-9 ]/gi, '')+'.macros.xml');
        win.document.body.appendChild(element);
        element.click();
        setTimeout(() => {win.close();}, 500);
    }

    /* -------------------------------------------- */

    /**
     * Event listeners that require reloading when certain page elements change
     * @param {Dialog} dialog - Dialog instance
     */
    _customMacroEventListeners(html) {
        html.find('.macro-list-btn.fa-times').off('click').on('click', (ev) => {
            $(ev.target).closest('.macro').remove();
        });

        html.find('.macro-list-btn.fa-edit').off('click').on('click', (ev) => {
            let macroEl = $(ev.target).closest('.macro');
            let label = $(macroEl).find('.macro-label input').val();
            $(macroEl).find('.macro-edit').toggleClass('hide');
            $(macroEl).find('.macro-list-name').html(label.trim().length > 0 ? label.trim() : 'Unnamed Macro');
        });

        html.find('.macro-label input').off('change').on('change', (ev) => {
            html.find('.macro-tag').html(`Macro Tag: ${game.macros._macroTag('custom', $(ev.currentTarget).val())}`);
        }).on('keyup', (ev) => { $(ev.currentTarget).trigger('change') });
    }

    /* -------------------------------------------- */

    /**
     * Event listeners that require reloading when certain page elements change
     * @param {Dialog} dialog - Dialog instance
     */
    _rollableTableEventListeners(html) {
        html.find('.macro-list-btn.fa-times').off('click').on('click', (ev) => {
            $(ev.target).closest('.macro').remove();
        });

        html.find('.macro-list-btn.fa-edit').off('click').on('click', (ev) => {
            let macroEl = $(ev.target).closest('.macro');
            let label = $(macroEl).find('.macro-label input').val();
            $(macroEl).find('.macro-edit').toggleClass('hide');
            $(macroEl).find('.macro-list-name').html(label.trim().length > 0 ? label.trim() : 'Unnamed Table');
        });

        html.find('.add-table-entry').off('click').on('click', (ev) => {
            ev.preventDefault();
            html.find('.macro-table-entries').append(this._tableEntry('', ''));
            this._rollableTableEventListeners(html);
        });

        html.find('.table-entry-btn.fa-times').off('click').on('click', (ev) => {
            $(ev.currentTarget).closest('.macro-table').remove();
        });

        html.find('.macro-label input').off('change').on('change', (ev) => {
            html.find('.macro-tag').html(`Macro Tag: ${game.macros._macroTag('table', $(ev.currentTarget).val())}`);
        }).on('keyup', (ev) => { $(ev.currentTarget).trigger('change') });
    }

    /* -------------------------------------------- */

    /**
     * Prevent rendering if invalid data entered
     * @param force
     */
    render(force = false) {
        if (this.data.scope === 'actor' && !this.data.actor) throw "Actor entity not supplied";
        if (this.data.scope === 'world' && !this.data.world) throw "World data not supplied";
        if (['actor','world','global'].indexOf(this.data.scope) < 0) throw "Invalid macro type";
        super.render(force);
    }

    /* -------------------------------------------- */

    /**
     * Add tab to the macro configuration application
     * @param {String} options.tabId - the tab identifier
     * @param {String} options.tabName - the tab name
     * @param {String} options.html - the tab html
     * @param {Number} options.flex - the number of flex columns the tab handle uses
     * @param {Function} options.onLoad - the callback that is processed when the tab is loaded
     * @param {Function} options.onSave - the callback that is processed when the save button is clicked
     */
    addTab(options = {}) {
        const {
            tabId = null,
            tabName = null,
            html = null,
            flex = 1,
            onLoad = (html) => {
                console.log(`Tab '${tabId}' does not do anything upon loading. This functionality requires that it have a callback registered to the 'onLoad' property.`);
            },
            onSave = (html) => {
                console.log(`Tab '${tabId}' does not do anything upon saving. This functionality requires that it have a callback registered to the 'onSave' property.`);
            }
        } = options;

        if (!tabId) throw "Tab requires the 'tabId' property to identify the tab to the script.";
        if (!tabName) throw "Tab requires the 'tabName' property to identify the tab to the user.";
        if (!html) throw "Tab requires the 'html' property. This is the content of the tab.";
        
        this.data.tabs.push({
            id: tabId,
            name: tabName,
            html: html,
            flex: flex,
            onLoad: onLoad,
            onSave: onSave
        });
    }

    /* -------------------------------------------- */

    /**
     * Load the event handlers for the child tabs and the save button
     */
    activateListeners(html) {
        $(`.macro-sheet[data-window-id="${this.data.windowId}"] ~ button.save-macros`).off('click').on('click', ev => {
            ev.preventDefault();
            let macros = duplicate(game.macros.macros).filter(macro => {
                if (this.data.scope === 'actor' && macro.actor) return macro.actor.name !== this.data.actor.data.name;
                if (this.data.scope === 'world' && macro.world) return macro.world.name !== this.data.world.name;
                if (this.data.scope === 'global' && macro.global) return false;
                return true;
            });
            this.data.tabs.forEach(tab => {
                macros = tab.onSave(html, macros);
            });
            game.macros.save(macros);
            this.close();
        });

        this.data.tabs.forEach(tab => {
            tab.onLoad(html.find(`.tab[data-tab="${tab.id}"]`));
        });
    }

    /* -------------------------------------------- */

    /**
     * After rendering the main window, render all the child tabs
     * @private
     */
    _postRender(html, data) {
        this.data.tabs.forEach(tab => {
            html.find('.tabs').append(`<a class="item" data-tab="${tab.id}" style="flex: ${tab.flex};">${tab.name.replace(/ /g, '&nbsp;')}</a>`);
            html.find('.tabs').after(`<div class="tab" data-tab="${tab.id}">${tab.html}</div>`)
        });
        super._postRender(html, data);
        new Tabs(html.find('.sheet-tabs'), {
            initial: html.find('.item').get(0).dataset.tab
        });
        this.activateListeners(html);
    }

    /* -------------------------------------------- */

    /**
     * Custom macro item template
     * @returns {string}
     */
    static get _customMacroTemplate() {
        return `<div class="macro custom">
            <div class="macro-list">
                <div class="macro-list-name">
                    New Macro
                </div>
                <label>
                    <input type="checkbox" name="inbar" checked>
                    In Bar
                </label>
                <a class="macro-list-btn fas fa-edit"></a>
                <a class="macro-list-btn fas fa-times"></a>
            </div>
            <div class="macro-edit">
                <div class="macro-label">
                    <input type="text" name="label" placeholder="Macro Name" />
                </div>
                <div class="macro-color">
                    <input type="color" name="color" value="#ffffff" />
                </div>
                <div class="macro-content">
                    <textarea name="content" rows="8"></textarea>
                </div>
            </div>
        </div>`;
    }
}

class MacroBar extends Application {
    constructor() {
        super();

        this.macroTabs = new Tabs();
    }

    /**
     * Assign the default options which are supported by this Application
     */
    static get defaultOptions() {
        const options = super.defaultOptions;
        options.id = "macro-bar";
        options.template = CONFIG.Macros.templatePath+CONFIG.Macros.templates.macroBar;
        options.popOut = false;
        return options;
    }

    /* -------------------------------------------- */

    getData() {
        // Get the macros sorted into scopes
        let macroTabs = [];

        game.macros.macros
            .filter(macro => macro.global)
            .filter(macro => ((macro.type === 'custom' || macro.type === 'table') && (macro.inbar === 'Y' || macro.inbar == null)) || (macro.type !== 'custom' && macro.type !== 'table'))
            .forEach(macro => {
                let m = duplicate(macro);
                let mai = macroTabs.findIndex(ma => ma.name === 'global');
                if (mai < 0) {
                    mai = macroTabs.length;
                    macroTabs.push({ id: 'global', name: 'Global', macros: []});
                }
                m = this._colors(m);
                macroTabs[mai].macros.push(m);
            });
        game.macros.macros
            .filter(macro => macro.world)
            .filter(macro => ((macro.type === 'custom' || macro.type === 'table') && (macro.inbar === 'Y' || macro.inbar == null)) || (macro.type !== 'custom' && macro.type !== 'table'))
            .forEach(macro => {
                let m = duplicate(macro);
                if (macro.world.name !== game.data.world.name) return;
                let mai = macroTabs.findIndex(ma => ma.name === m.world.name);
                if (mai < 0) {
                    mai = macroTabs.length;
                    macroTabs.push({ id: 'world', name: m.world.name, macros: []});
                }
                m = this._colors(m);
                macroTabs[mai].macros.push(m);
            });
        game.macros.macros
            .filter(macro => macro.actor)
            .filter(macro => ((macro.type === 'custom' || macro.type === 'table') && (macro.inbar === 'Y' || macro.inbar == null)) || (macro.type !== 'custom' && macro.type !== 'table'))
            .sort((a, b) => {
                if(a.actor.name !== b.actor.name) {
                    return a.actor.name > b.actor.name ? 1 : -1
                }
            })
            .forEach(macro => {
                let m = duplicate(macro);
                if (!game.actors.entities.find(a => a.data.name === m.actor.name)) return;
                let mai = macroTabs.findIndex(ma => ma.name === m.actor.name);
                if (mai < 0) {
                    mai = macroTabs.length;
                    macroTabs.push(Object.assign(m.actor, {macros: []}));
                }
                m = this._colors(m);
                macroTabs[mai].macros.push(m);
            });

        return { tabs: macroTabs, hasMacros: macroTabs.length > 0 };
    }

    /* -------------------------------------------- */

    /**
     * Render the bar if the user has added any macros
     */
    render(force = false) {
        if (!this.getData().hasMacros) {
            this.close();
            return;
        }
        super.render(force);
    }

    /* -------------------------------------------- */

    _colors(macro) {
        if (macro.type === 'custom' || macro.type === 'table') {
            macro.textColor = this.constructor._isLight(macro.color || '#ffffff') ? '#000000' : '#ffffff';
        }
        return macro;
    }

    static _isLight(color) {
        let c = color.substring(1);      // strip #
        let rgb = parseInt(c, 16);   // convert rrggbb to decimal
        let r = (rgb >> 16) & 0xff;  // extract red
        let g = (rgb >>  8) & 0xff;  // extract green
        let b = (rgb >>  0) & 0xff;  // extract blue

        let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b; // per ITU-R BT.709

        return luma >= 128;
    }

    /* -------------------------------------------- */

    /**
     * After rendering the main Macro Bar container, render all the child tabs
     * @private
     */
    _postRender(html, data) {
        super._postRender(html, data);
        this.macroTabs = new Tabs(html.find('.bar-tabs'), {
            initial: html.find('.item').get(0).dataset.tab
        });
    }

    /* -------------------------------------------- */

    /**
     * Handle custom macros internally, and other macros externally.
     */
    activateListeners(html) {
        $('button[data-macro-id]').off('click').on('click', ev => {
            const mid = parseInt($(ev.target).attr('data-macro-id'));
            const macro = game.macros.macros.find(m => m.mid === mid);

            if (macro.actor) {
                var actor = game.actors.entities.find(a => a._id === macro.actor.id);
            } else {
                const cTokens = canvas.tokens.controlledTokens;
                if (cTokens.length === 1) {
                    var actor = game.actors.entities.find(a => a._id === cTokens[0].data.actorId);
                }
            }

            if (macro.type === 'custom') {
                game.macros.parseToMessage(ui.chat, macro, actor);
            } else if (macro.type === 'table') {
                game.macros.rollTableToMessage(ui.chat, macro, actor);
            } else {
                Hooks.call('triggerMacro', macro, actor);
            }
        });

        $('#macro-bar').hide();
        // When token is selected, select the corresponding actor tab in the macro bar.
        canvas.stage.on('mouseup', (ev) => {
            if (!(ev.target instanceof Token)) { $('#macro-bar').hide(); return; }
            if (canvas.tokens.controlledTokens.length === 1) {
                this.macroTabs._activateTab($(`.macro-bar .item[data-tab="${canvas.tokens.controlledTokens[0].data.actorId}"]`));
                $('#macro-bar').show();
            } else if (game.macros.macros.find(m => m.world || m.global)) {
                $('#macro-bar').hide();
            }
        });
    }
}

CONFIG.Macros = {
    templatePath: 'public/modules/fvtt-enhancement-suite/templates/macros',
    templates: {
        macroConfig: '/macro-config.html',
        macroBar: '/macro-bar.html'
    }
};