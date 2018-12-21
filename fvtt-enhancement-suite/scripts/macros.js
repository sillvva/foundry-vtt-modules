let macroTemplatePath = 'public/modules/fvtt-enhancement-suite/templates/macros';

class SuiteHooks extends Hooks {
    static callAllValues(hook, initial, ...args) {
        if (!hooks.hasOwnProperty(hook)) return;
        console.log(`${vtt} | Called ${hook} hook`);
        return hooks[hook].reduce((i, fn) => fn(i, ...args) || i, initial);
    }
}

class Macros {
    constructor() {
        this.macros = [];
        this.actors = [];
        this.actorTabs = new Tabs();
        this.rollReferences = {};

        // Register hooks
        this.hookReady();
        this.hookActor();
        this.hookSettings();
    }

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
            game.settings.set(game.data.system.name, 'macros', JSON.stringify(this.actorMacros
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
                    game.settings.set(game.data.system.name, 'macros', JSON.stringify(this.actorMacros.filter(m => m.actor.id !== id)));
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

    // SEND MESSAGE

    /**
     * Create chat entry in ChatLog
     * @param message
     */
    createMessage(message) {
        // Set up chat data
        const chatData = {
            user: game.user._id
        };

        // Parse the message to determine the matching handler
        let [chatType, rgx] = ChatLog.parse(message);
        let [type, match] = ChatLog.parse(message);
        if ( match) chatData['content'] = match[2];
        else chatData['content'] = message;

        // Handle dice rolls
        let roll;
        if ( type === "roll" ) {
            let data = Roll._getActorData();
            chatData['roll'] = new Roll(match[2], data);
        }

        // In-Character or Emote
        else if ( ["ic", "emote"].includes(type) ) {
            let alias;
            if ( game.user.character ) alias = game.user.character.name;
            else if ( game.user.isGM && canvas.ready ) {
                let token = canvas.tokens.controlledTokens.find(t => t.actor !== undefined);
                if ( token ) alias = token.actor.name;
            }
            if ( !alias ) return;
            chatData['alias'] = alias;
            if ( type === "emote" ) chatData["content"] = `${alias} ${chatData['content']}`;
        }

        if ( chatData["roll"] ) chatData["roll"].toMessage();
        else ChatMessage.create(chatData, true);
    }

    /**
     * Parse a macro and create chat entry in ChatLog
     * @param message
     */
    parseToMessage(content, actor) {
        this.parse(content, actor, content.indexOf('/roll') === 0).then(message => {
            this.createMessage(message);
        });
    }

    // MACROS

    /**
     * Store macros in memory
     * @param scope
     * @param macros
     */
    save(macros) {
        game.settings.set(game.data.system.name, 'macros', JSON.stringify(macros));
    }

    /**
     * Store macros in temporary memory
     * @param scope
     * @param macros
     */
    set(macros) {
        game.macros.macros = macros;
        game.macros.renderMacroBar();
        // game.settings.set(game.data.system.name, 'macros', JSON.stringify(macros));
    }

    /* -------------------------------------------- */

    /**
     * Parse message content for custom macro syntax
     * @param content
     * @param actor
     * @param tooltips
     * @returns {Promise<any>}
     */
    parse(content, actor, tooltips = false) {
        return new Promise((resolve, reject) => {
            this.parsePrompts(duplicate(content)).then((parsed) => {
                let message = this.parsePromptOptionReferences(parsed.message, parsed.references);
                message = SuiteHooks.callAllValues('parseActorData', message, actor);
                message = this.parseRolls(message, tooltips);
                message = this.parseRollReferences(message);
                resolve(message);
            });
        });
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
    parsePrompts(message) {
        return new Promise((resolve, reject) => {
            this.parsePromptTags(message, resolve);
        });
    }

    /* -------------------------------------------- */

    /**
     * @param {String} message - the message to be parsed
     * @param {*} resolve - the resolve callback for the promise
     * @param {Object} parsed - previously parsed queries
     */
    parsePromptTags(message, resolve, parsed = {}) {
        // const rgx = "\\?{(?!:)(\\[(?<listType>(list|checkbox|radio))(?<optionDelimiter>\\|([^\\]]+)?)?\\])?(?<query>[^\\|}]+)\\|?(?<list>(([^,{}\\|]|{{[^}]+}})+,([^\\|{}]|{{[^}]+}})+\\|?)+)?(?<defaultValue>([^{}]|{{[^}]+}})+)?}"
        const rgx = "\\?{(?!:)(\\[(list|checkbox|radio)(\\|([^\\]]+)?)?\\])?([^\\|}]+)\\|?((([^,{}\\|]|{{[^}]+}})+,([^\\|{}]|{{[^}]+}})+\\|?)+)?(([^{}]|{{[^}]+}})+)?}"
        const p = message.match(new RegExp(rgx, 'i'));
        if (!p) {
            game.settings.set('core', 'promptOptionsMemory', JSON.stringify(this.optMemory));
            resolve({message: message, references: parsed});
        } else {
            const tag = p[0];

            if (!this.optMemory[tag]) this.optMemory[tag] = {};

            const listType = p[2] || 'list';
            const query = p[5].trim();
            const list = p[6];
            const defaultValue = p[11];
            const optionDelimiter = (p[3] || '|, ').substr(1);

            if (list) {
                let html = '<p>' + query + '</p>';
                let inputTag = '';
                if (listType === 'list') {
                    inputTag = '.list-prompt[query="' + query.replace(/"/g, '\\"') + '"]';

                    html += '<p><select class="list-prompt" query="' + query.replace(/"/g, '\\"') + '">';
                    list.split('|').forEach((listItem) => {
                        const parts = listItem.split(',');
                        const liLabel = parts[0].trim();
                        const selected = this.optMemory[tag].value === parts.slice(1).join(',').trim().replace(/"/g, '\\"');
                        html += '<option value="' + parts.slice(1).join(',').trim().replace(/"/g, '\\"') + '" ' + (selected ? 'selected' : '') + '>' + parts[0].trim() + '</option>';
                    });
                    html += '</select></p>';
                } else if (listType === 'checkbox' || listType === 'radio') {
                    inputTag = '.list-prompt';

                    html += '<form class="list-prompt">';
                    list.split('|').forEach((listItem) => {
                        const parts = listItem.split(',');
                        const liLabel = listType === 'checkbox' ? parts[0].trim().replace(/"/g, '\\"') : query;
                        const checked = this.optMemory[tag][liLabel] === parts.slice(1).join(',');
                        html += '<p><label><input type="' + listType + '" name="' + liLabel + '" value="' + parts.slice(1).join(',').trim().replace(/"/g, '\\"') + '" ' + (checked ? 'checked' : '') + ' /> ' + parts[0].trim() + '</label></p>'
                    });
                    html += '</form>';
                }

                if (parsed[query]) {
                    // Use previous input for repeated queries and selected options
                    this.parsePromptTags(message.replace(tag, parsed[query]), resolve, parsed);
                } else {
                    new Dialog({
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
                                        this.parsePromptTags(message.replace(tag, inputValue.split(',')[0]), resolve, parsed);
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
                                        this.parsePromptTags(message.replace(tag, input), resolve, parsed);
                                    }
                                }
                            }
                        }
                    }).render(true);
                }
            } else {
                const input = parsed[query] || prompt(query, defaultValue != null ? defaultValue.trim() : '');
                parsed[query] = [input];
                this.parsePromptTags(message.replace(tag, input || ''), resolve, parsed);
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
        // const p = message.match(new RegExp("\\?{:(?<query>[^\\|}]+)\\|?(?<defaultValue>([^{}]|{{[^}]+}})+)?}", "i"));
        const p = message.match(new RegExp("\\?{:([^\\|}]+)\\|?(([^{}]|{{[^}]+}})+)?}", "i"));
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
    parseRolls(message, tooltip = false) {
        // create message nodes we can parse through
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
            this._parseRolls(messageEl, messageEl.nodeName, tooltip);

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
    _parseRolls(xml, nodeName, tooltip) {
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
                        if (xml.innerHTML.substr(0, 1) !== '/' && tooltip) {
                            outVal += '<span title="' + parseString.replace(/"/g, '\\"') + '">' + add + '</span>';
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
        const rolls = Object.keys(this.rollReferences).filter(key => key.indexOf('_ref') >= 0);
        const m = message.match(/@{([^\|}]+)(\|([^\|}]+))?(\|(([^\|}]+(\|)?)+))?}/i);
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

        Hooks.callAll('preRenderMacroConfig', this, this.getData());
    }

    /* -------------------------------------------- */

    /**
     * Assign the default options which are supported by this Application
     */
    static get defaultOptions() {
        const options = super.defaultOptions;
        options.title = "Macro Configuration";
        options.template = macroTemplatePath+"/macro-config.html";
        options.width = 600;
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
                output += `<div class="macro custom">
                    <div class="macro-list">
                        <div class="macro-list-name">
                            ${macro.label}
                        </div>
                        <a class="macro-list-btn fas fa-edit"></a>
                        <a class="macro-list-btn fas fa-times"></a>
                    </div>
                    <div class="macro-edit hide">
                        <div class="macro-label">
                            <input type="text" name="label" value="${macro.label}" placeholder="Macro Name" data-type="String" />
                        </div>
                        <div class="macro-content">
                            <textarea name="content" rows="8" data-type="String">${macro.content}</textarea>
                        </div>
                    </div>
                </div>`;
                return output;
            }, '');

        const tab = {
            tabId: 'custom',
            tabName: 'Custom',
            html: `<div class="macros">
                    `+existingMacros+`
                </div>
                <div class="macro-action-bar">
                    <button class="new-custom-macro btn btn-dark" role="button">Add Macro</button>
                </div>`,
        };

        tab.onLoad = (html) => {
            html.find('.new-custom-macro').off('click').on('click', (ev) => {
                ev.preventDefault();
                html.find('.macros').append(this.constructor._customMacroTemplate);
                this._customMacroEventListeners(html);
            });
            this._customMacroEventListeners(html);
        };

        tab.onSave = (html, macros) => {
            const macroEntries = html.find('.macro.custom');
            for(let i = 0; i < macroEntries.length; i++) {
                let label = $(macroEntries[i]).find('[name="label"]').val();
                let content = $(macroEntries[i]).find('[name="content"]').val();
                if (label.length === 0) continue;

                let data = {
                    mid: macros.length,
                    cid: i,
                    type: 'custom',
                    label: label,
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
     * @param {String} options.callback - the callback that is processed when the save button is clicked
     */
    addTab(options = {}) {
        const {
            tabId = null,
            tabName = null,
            html = null,
            flex = 1,
            onLoad = (html) => {},
            onSave = (html) => {}
        } = options;

        if (!tabId) throw "Tab requires tabId.";
        if (!tabName) throw "Tab requires tabName.";
        if (!html) throw "Tab requires html.";

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
            html.find('.tabs').append(`<a class="item" data-tab="${tab.id}" style="flex: ${tab.flex};">${tab.name}</a>`);
            html.find('.tabs').after(`<div class="tab" data-tab="${tab.id}">${tab.html}</div>`)
        });
        super._postRender(html, data);
        new Tabs(html.find('.sheet-tabs'), html.find('.item').get(0).dataset.tab);
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
                <a class="macro-list-btn fas fa-edit"></a>
                <a class="macro-list-btn fas fa-times"></a>
            </div>
            <div class="macro-edit">
                <div class="macro-label">
                    <input type="text" name="label" placeholder="Macro Name" />
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
        options.template = macroTemplatePath+"/macro-bar.html";
        options.popOut = false;
        return options;
    }

    /* -------------------------------------------- */

    getData() {
        // Get the macros sorted into actors
        let macroTabs = [];

        game.macros.macros.filter(macro => macro.global).forEach(macro => {
            let m = duplicate(macro);
            let mai = macroTabs.findIndex(ma => ma.name === 'global');
            if (mai < 0) {
                mai = macroTabs.length;
                macroTabs.push({ id: 'global', name: 'Global', macros: []});
            }
            macroTabs[mai].macros.push(m);
        });
        game.macros.macros.filter(macro => macro.world).forEach(macro => {
            let m = duplicate(macro);
            if (macro.world.name !== game.data.world.name) return;
            let mai = macroTabs.findIndex(ma => ma.name === m.world.name);
            if (mai < 0) {
                mai = macroTabs.length;
                macroTabs.push({ id: 'world', name: m.world.name, macros: []});
            }
            macroTabs[mai].macros.push(m);
        });
        game.macros.macros.filter(macro => macro.actor)
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

    /**
     * After rendering the main Macro Bar container, render all the child tabs
     * @private
     */
    _postRender(html, data) {
        super._postRender(html, data);
        this.macroTabs = new Tabs(html.find('.bar-tabs'), html.find('.item').get(0).dataset.tab);
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
                game.macros.parseToMessage(macro.content, actor);
            } else {
                Hooks.call('triggerMacro', macro, actor);
            }
        });

        // When token is selected, select the corresponding actor tab in the macro bar.
        canvas.stage.on('mouseup', (ev) => {
            if (!(ev.target instanceof Token)) return;
            if (canvas.tokens.controlledTokens.length === 1) {
                this.macroTabs.activateTab($(`.macro-bar .item[data-tab="${canvas.tokens.controlledTokens[0].data.actorId}"]`));
            }
        });
    }
}