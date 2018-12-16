/**
 * Enhancement Suite
 * @author Matt DeKok <Sillvva>
 * @version 0.2.4
 */

class EnhancementSuite {

    constructor() {
        this.actors = [];
        this.macros = [];
        this.actorTabs = new Tabs();

        // Register hooks
        this.hookReady();
        this.hookToolbarReady();
        this.hookActor5eSheet();
        this.hookActorPFSheet();
        this.hookActor();
        this.hookChat();
    }

    /**
     * Hook into the ready call for the VTT application
     */
    hookReady() {
        Hooks.on('ready', () => {
            game.settings.register(game.data.system.name, "macros", {
                name: "Macros",
                hint: "Macros for quick access to chat commands",
                default: "[]",
                type: String,
                onChange: macros => {
                    this.macros = JSON.parse(macros);
                    this.renderMacroBar();
                }
            });
            game.settings.register(game.data.system.name, "promptOptionsMemory", {
                name: "Prompt Options Memory",
                hint: "Memory of previously selected options",
                default: "{}",
                type: String,
                onChange: memory => {
                    this.optMemory = JSON.parse(memory);
                }
            });
            game.settings.register("core", "sheetToolbarCollapsed", {
                name: "Actor Sheet Toolbar Collapsed",
                hint: "",
                default: false,
                type: Boolean,
                onChange: collapsed => {
                    this.toolbarCollapsed = collapsed;
                    if (collapsed) {
                        $('.window-app.sheet').addClass('toolbar-collapsed');
                    } else {
                        $('.window-app.sheet').removeClass('toolbar-collapsed');
                    }
                }
            });

            this.optMemory = JSON.parse(game.settings.get(game.data.system.name, 'promptOptionsMemory'));
            this.macros = JSON.parse(game.settings.get(game.data.system.name, "macros"));
            this.toolbarCollapsed = game.settings.get("core", "sheetToolbarCollapsed");

            // Handle update from 0.1.5 to 0.2.0
            if(!this._update015to020()) { this.renderMacroBar(); }

            // Used to determine actor permissions when actor is deleted.
            // If actor is not owned, stored macros will be removed.
            this.actors = duplicate(game.actors.source);

            // Ensure existing macros actor ids match up with current worlds's actors with same name
            this.assignMacros();

            this.hookCanvasEvents();
        });
    }

    /**
     * Hook into the render call for the Actor5eSheet
     */
    hookActor5eSheet() {
        Hooks.on('renderActor5eSheet', (app, html, data) => {
            if (!data.owner) return;

            const windowContent = html.parent().parent();
            const toolbar = $('<div class="actor-sheet-toolbar"><div class="toolbar-header">Toolbar</div></div>');

            if (this.toolbarCollapsed) {
                windowContent.addClass('toolbar-collapsed');
            }

            windowContent.find('.actor-sheet-toolbar').remove();
            windowContent.prepend(toolbar);

            $('.actor-sheet-toolbar .toolbar-header').dblclick(() => {
                windowContent.toggleClass('toolbar-collapsed');
                this.toolbarCollapsed = !this.toolbarCollapsed;
                game.settings.set("core", "sheetToolbarCollapsed", this.toolbarCollapsed);
            });

            // Macro Configuration Button
            this.addToolbarButton(toolbar, 'far fa-keyboard', 'Macros', () => {
                this.macroDialog(app.actor);
            });

            Hooks.call('toolbarReady', toolbar, app.actor);
            Hooks.call('toolbar5eReady', toolbar, app.actor);
        });
    }

    /**
     * Hook into the render call for the ActorPFSheet
     */
    hookActorPFSheet() {
        Hooks.on('renderActorPFSheet', (app, html, data) => {
            if (!data.owner) return;

            const windowContent = html.parent();
            const toolbar = $('<div class="actor-sheet-toolbar"><div class="toolbar-header">Toolbar</div></div>');

            windowContent.find('.actor-sheet-toolbar').remove();
            windowContent.prepend(toolbar);

            Hooks.call('toolbarReady', toolbar, app.actor);
            Hooks.call('toolbarPFReady', toolbar, app.actor);
        });
    }

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

    /**
     * Hook into the render call for the ChatLog
     */
    hookChat() {
        Hooks.on('renderChatLog', (log, html, data) => {
            this.chatListeners(log, html, data);
        });
        Hooks.on('chatMessage', (chatLog, chatData) => {
            const hasMacro = chatData.content.match(/{{.+}}|\[\[.+\]\]|<<.+>>|\?{.+}|@{.+}/);
            if (hasMacro) {
                const hasRoll = chatData.roll;
                const cTokens = canvas.tokens.controlledTokens;
                if (cTokens.length === 1) {
                    var actor = game.actors.entities.find(a => a._id === cTokens[0].data.actorId);
                }
                this.parseMessageContent(chatData.content, actor, !hasRoll).then(content => {
                    if (hasRoll) {
                        const data = Roll._getActorData();
                        const roll = new Roll(content, data);
                        roll.toMessage();
                    } else {
                        ChatMessage.create({ user: game.user._id, content: content }, true);
                    }
                });
                return false;
            }
        });
    }

    /**
     * Hook into the render call for the Toolbar
     */
    hookToolbarReady() {
        Hooks.on('toolbarReady', (toolbar, actor) => {
            // Export Button
            this.addToolbarButton(toolbar, 'fas fa-download', 'Export Data', () => {
                this.exportActor(actor);
            });

            // Import Button
            this.addToolbarButton(toolbar, 'fas fa-upload', 'Import Data', () => {
                const input = $('<input type="file" accept="application/json" class="file-import hide" />');
                toolbar.find('.file-import').remove();
                toolbar.append(input);
                input.change((e) => {
                    for (let i = 0; i < e.target.files.length; i++) {
                        const file = e.target.files[i];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                this.importActor(actor, JSON.parse(e.target.result));
                                toolbar.find('.file-import').remove();
                            };
                            reader.readAsText(file);
                        }
                    }
                }).click();
            });
        });
    }

    /**
     * Hook into the canvas events
     */
    hookCanvasEvents() {
        canvas.stage.on('mouseup', (ev) => {
            if (!(ev.target instanceof Token)) return;
            if (canvas.tokens.controlledTokens.length === 1) {
                this.actorTabs.activateTab($(`.macro-bar .item[data-tab="${canvas.tokens.controlledTokens[0].data.actorId}"]`));
            }
        });
    }

    /**
     * Ensure existing macros actor ids match up with current worlds's actors with same name
     */
    assignMacros(store = true) {
        this.macros = this.macros.map((macro, mid) => {
            game.actors.source
                .filter(a => a.name === macro.actor.name && a._id !== macro.actor.id)
                .forEach(a => {
                    if (game.user.isGM || Object.keys(a.permission).find(p => p[0] === game.user.data._id && p[1] === 3)) {
                        macro.actor.id = a._id;
                    }
                });
            macro.mid = mid;
            return macro;
        });
        if (store) {
            game.settings.set(game.data.system.name, 'macros', JSON.stringify(this.macros));
        }
    }

    /**
     * Add button to the toolbar
     * @param toolbar
     * @param icon
     * @param label
     * @param callback
     * @returns {jQuery|HTMLElement}
     */
    addToolbarButton(toolbar, icon, label, callback = () => {}) {
        const id = label.toLowerCase().replace(/[^a-z0-9]+/gi,'-');
        const button = $('<button class="btn btn-dark btn-'+id+'" title="'+label.replace(/"/g, '\\"')+'"><i class="'+icon+'"></i><span>'+label+'</span></button>');
        toolbar.find('.btn-'+id).remove();
        toolbar.append(button);
        button.click((ev) => {
            ev.preventDefault();
            callback();
        });
        return button;
    }

    /**
     * Render the macro configuration dialog box
     * @param {Object} actor - actor entity
     */
    macroDialog(actor) {
        if (!this.macros) return;
        const macros = this.macros.filter(macro => actor.data.name === macro.actor.name);
        const items = duplicate(actor.data.items);

        // generic (base) macro configuration
        const data = {
            actor: actor,
            system: game.data.system.name,
            hasMacros: {
                weaponsSpells: items.filter(item => item.type === 'weapon' || item.type === 'spell').length > 0,
                weapons: items.filter(item => item.type === 'weapon').length > 0,
                spells: items.filter(item => item.type === 'spell').length > 0,
                tools: items.filter(item => item.type === 'tool').length > 0,
                abilities5e: false,
                saves5e: false
            },
            macros: {
                weapons: items.filter(item => item.type === 'weapon')
                    .map(item => {
                        item.enabled = macros.find(macro => macro.type === 'weapon' && parseInt(macro.iid) === item.id) != null;
                        item.data.hit = '';
                        item.data.damage.value = item.data.damage.value.replace('+0','');
                        return item;
                    }),
                spells: items.filter(item => item.type === 'spell')
                    .sort((a, b) => {
                        if (parseInt(a.data.level.value) === parseInt(b.data.level.value)) {
                            return a.name > b.name ? 1 : -1;
                        }
                        else {
                            return parseInt(a.data.level.value) - parseInt(b.data.level.value)
                        }
                    })
                    .map(item => {
                        item.enabled = macros.find(macro => macro.type === 'spell' && parseInt(macro.iid) === item.id) != null;
                        item.school = '';
                        return item;
                    }),
                tools: items.filter(item => item.type === 'tool')
                    .map(item => {
                        item.enabled = macros.find(macro => macro.type === 'tool' && parseInt(macro.iid) === item.id) != null;
                        return item;
                    }),
                custom: macros.filter(macro => macro.type === 'custom')
            }
        };

        // macro configuration for dnd5e
        if (game.data.system.name === CONFIG.EnhancementSuite.settings.dnd5e) {
            data.hasMacros.abilities5e = true;
            data.macros.abilities = {
                prompt: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'prompt') || false,
                    str: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'str') || false,
                    dex: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'dex') || false,
                    con: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'con') || false,
                    int: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'int') || false,
                    wis: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'wis') || false,
                    cha: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'cha') || false,
                    acr: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'acr') || false,
                    ani: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ani') || false,
                    arc: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'arc') || false,
                    ath: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ath') || false,
                    dec: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'dec') || false,
                    his: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'his') || false,
                    ins: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ins') || false,
                    itm: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'itm') || false,
                    inv: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'inv') || false,
                    med: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'med') || false,
                    nat: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'nat') || false,
                    prc: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'prc') || false,
                    prf: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'prf') || false,
                    per: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'per') || false,
                    rel: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'rel') || false,
                    slt: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'slt') || false,
                    ste: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ste') || false,
                    sur: macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'sur') || false
            };

            data.hasMacros.saves5e = true;
            data.macros.saves = {
                prompt: macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'prompt') || false,
                    str: macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'str') || false,
                    dex: macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'dex') || false,
                    con: macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'con') || false,
                    int: macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'int') || false,
                    wis: macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'wis') || false,
                    cha: macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'cha') || false
            };

            data.macros.weapons = data.macros.weapons.map(item => {
                let toHit = !isNaN(item.data.bonus.value) ? parseInt(item.data.bonus.value || 0) : 0;
                toHit += item.data.proficient.value ? Math.floor((parseInt(actor.data.data.details.level.value) + 7) / 4) : 0;
                toHit += Math.floor((parseInt(actor.data.data.abilities[item.data.ability.value].value) - 10) / 2);
                item.data.hit = toHit;
                return item;
            });

            data.macros.spells = data.macros.spells.map(item => {
                item.school = CONFIG.EnhancementSuite.spellSchools[item.data.school.value] || item.data.school.value;
                return item;
            });
        }
        renderTemplate(this.constructor._templatePath+'/macros/macro-configuration.html', data).then(html => {
            const dialog = new Dialog({
                title: "Macro Configuration",
                content: html,
                buttons: {
                    "import": {
                        icon: '',
                        label: "Save",
                        callback: () => {
                            let macros = duplicate(this.macros.filter(macro => macro.actor.name !== actor.data.name));

                            if (data.hasMacros.weapons) {
                                // Weapon Macros
                                const weaponEntries = $('.macro-sheet[data-actor-id="'+actor._id+'"] [data-tab="weapons-spells"] .weapon');
                                for(let i = 0; i < weaponEntries.length; i++) {
                                    if (!$(weaponEntries[i]).find('.enable').get(0).checked) continue;
                                    let label = $(weaponEntries[i]).find('.weapon-name').html();
                                    let wid = $(weaponEntries[i]).attr('data-weapon-id');
                                    macros.push({
                                        mid: macros.length,
                                        iid: parseInt(wid),
                                        type: 'weapon',
                                        actor: { id: actor._id, name: actor.data.name },
                                        label: label
                                    });
                                }
                            }

                            if (data.hasMacros.spells) {
                                // Spell Macros
                                const spellEntries = $('.macro-sheet[data-actor-id="'+actor._id+'"] [data-tab="weapons-spells"] .spell');
                                for(let i = 0; i < spellEntries.length; i++) {
                                    if (!$(spellEntries[i]).find('.enable').get(0).checked) continue;
                                    let label = $(spellEntries[i]).find('.spell-name').html();
                                    let sid = $(spellEntries[i]).attr('data-spell-id');
                                    macros.push({
                                        mid: macros.length,
                                        iid: parseInt(sid),
                                        type: 'spell',
                                        actor: { id: actor._id, name: actor.data.name },
                                        label: label
                                    });
                                }
                            }

                            if (data.hasMacros.abilities5e) {
                                // Ability Check Macros
                                const abilityEntries = $('.macro-sheet[data-actor-id="'+actor._id+'"] [data-tab="ability-checks"] input[type="checkbox"]');
                                for(let i = 0; i < abilityEntries.length; i++) {
                                    if (!$(abilityEntries[i]).get(0).checked) continue;
                                    let label = $(abilityEntries[i]).attr('name');
                                    let subtype = $(abilityEntries[i]).attr('class');
                                    macros.push({
                                        mid: macros.length,
                                        type: 'ability-check',
                                        subtype: subtype,
                                        actor: { id: actor._id, name: actor.data.name },
                                        label: label
                                    });
                                }
                            }

                            if (data.hasMacros.saves5e) {
                                // Saving Throw Macros
                                const saveEntries = $('.macro-sheet[data-actor-id="'+actor._id+'"] [data-tab="saving-throws"] input[type="checkbox"]');
                                for(let i = 0; i < saveEntries.length; i++) {
                                    if (!$(saveEntries[i]).get(0).checked) continue;
                                    let label = $(saveEntries[i]).attr('name');
                                    let subtype = $(saveEntries[i]).attr('class');
                                    macros.push({
                                        mid: macros.length,
                                        type: 'saving-throw',
                                        subtype: subtype,
                                        actor: { id: actor._id, name: actor.data.name },
                                        label: label
                                    });
                                }
                            }

                            if (data.hasMacros.tools) {
                                // Tool Macros
                                const toolEntries = $('.macro-sheet[data-actor-id="'+actor._id+'"] [data-tab="tools"] .tool');
                                for(let i = 0; i < toolEntries.length; i++) {
                                    if (!$(toolEntries[i]).find('.enable').get(0).checked) continue;
                                    let label = $(toolEntries[i]).find('.tool-name').html();
                                    let tid = $(toolEntries[i]).attr('data-tool-id');
                                    macros.push({
                                        mid: macros.length,
                                        iid: parseInt(tid),
                                        type: 'tool',
                                        actor: { id: actor._id, name: actor.data.name },
                                        label: label
                                    });
                                }
                            }

                            // Custom Macros
                            const macroEntries = $('.macro-sheet[data-actor-id="'+actor._id+'"] [data-tab="custom"] .macro');
                            for(let i = 0; i < macroEntries.length; i++) {
                                let label = $(macroEntries[i]).find('[name="label"]').val();
                                let content = $(macroEntries[i]).find('[name="content"]').val();
                                if (label.length === 0) continue;
                                macros.push({
                                    mid: macros.length,
                                    cid: i,
                                    type: 'custom',
                                    actor: { id: actor._id, name: actor.data.name },
                                    label: label,
                                    content: content
                                });
                            }

                            game.settings.set(game.data.system.name, "macros", JSON.stringify(macros));
                        }
                    },
                    "cancel": {
                        icon: '',
                        label: "Cancel",
                        callback: () => {}
                    }
                }
            }, {
                width: 600
            }).render(true);

            setTimeout(() => {
                dialog.element.find('.new-custom-macro').off('click').on('click', (ev) => {
                    ev.preventDefault();
                    dialog.element.find('.tab[data-tab="custom"] .macros').append(this.constructor._macroItemTemplate);
                    this.addCustomMacroEventListeners(dialog);
                });

                const tabs = new Tabs(dialog.element.find('.sheet-tabs'), dialog.element.find('.item').get(0).dataset.tab);

                dialog.element.find('.weapon *, .spell *, .tool *').off('click').on('click', (ev) => {
                    let el = $(ev.target).closest('.item').find('.enable').get(0);
                    el.checked = !el.checked;
                });

                this.addCustomMacroEventListeners(dialog);
            }, 10);
        });
    }

    /**
     * Event listeners that require reloading when certain page elements change
     * @param {Dialog} dialog - Dialog instance
     */
    addCustomMacroEventListeners(dialog) {
        dialog.element.find('.macro-list-btn.fa-times').off('click').on('click', (ev) => {
            $(ev.target).closest('.macro').remove();
        });

        dialog.element.find('.macro-list-btn.fa-edit').off('click').on('click', (ev) => {
            let macroEl = $(ev.target).closest('.macro');
            let label = $(macroEl).find('.macro-label input').val();
            $(macroEl).find('.macro-edit').toggleClass('hide');
            $(macroEl).find('.macro-list-name').html(label.trim().length > 0 ? label.trim() : 'Unnamed Macro');
        });
    }

    /**
     * Render the 5e macro bar
     */
    renderMacroBar() {
        if(this.macros.length === 0) return;

        // Ensure existing macros actor ids match up with current worlds's actors with same name
        this.assignMacros(false);

        // Get the macros sorted into actors
        let macroActors = [];
        this.macros.forEach(macro => {
            let m = duplicate(macro);
            if (!game.actors.entities.find(a => a.data.name === m.actor.name)) return;
            let mai = macroActors.findIndex(ma => ma.name === m.actor.name);
            if (mai < 0) {
                mai = macroActors.length;
                macroActors.push(Object.assign(m.actor, {macros: []}));
            }
            macroActors[mai].macros.push(m);
        });
        macroActors = macroActors.sort((a, b) => a.name > b.name ? 1 : -1);

        // Render the macro bar template
        renderTemplate(this.constructor._templatePath+'/macros/macro-bar.html', {
            macroActors: macroActors,
            macroActorsExist: macroActors.length > 0
        }).then(html => {
            $('body .macro-bar').remove();
            const body = $(html);
            $('body').append(body);
            if(macroActors.length > 0) {
                this.actorTabs = new Tabs(body.find('nav.tabs'), macroActors[0].id);
            }

            $('.macro-bar [data-macro-id]').click((ev) => {
                const macroId = parseInt($(ev.target).attr('data-macro-id'));
                const macro = this.macros.find(m => m.mid === macroId);

                if (macro.type === 'custom') {
                    if (!macro.content) return;
                    this.parseMessageContent(macro.content, macro.actor).then(message => {
                        this.createMessage(message);
                    });
                }

                if (game.data.system.name == CONFIG.EnhancementSuite.settings.dnd5e) {
                    if (macro.type === 'weapon' || macro.type === 'spell') {
                        let actor = game.actors.entities.find(a => a.data.name === macro.actor.name).data;
                        let itemId = Number(macro.iid),
                            Item = CONFIG.Item.entityClass,
                            item = new Item(actor.items.find(i => i.id === itemId), actor);
                        item.roll();
                    }

                    if (macro.type === 'tool') {
                        let actor = game.actors.entities.find(a => a.data.name === macro.actor.name);
                        let itemId = Number(macro.iid),
                            Item = CONFIG.Item.entityClass,
                            item = new Item(actor.items.find(i => i.id === itemId), actor);
                        item.roll();
                    }

                    if (macro.type === 'saving-throw') {
                        let actor = game.actors.entities.find(a => a.data.name === macro.actor.name);
                        if (macro.subtype === 'prompt') {
                            const dialog = new Dialog({
                                title: "Saving Throw",
                                content: this.constructor._saves5ePromptTemplate
                            }).render(true);

                            setTimeout(() => {
                                ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach((abl) => {
                                    dialog.element.find('.'+abl).off('click').on('click', () => {
                                        dialog.close();
                                        actor.rollAbilitySave(abl);
                                    });
                                });
                            }, 10);
                        } else {
                            actor.rollAbilitySave(macro.subtype);
                        }
                    }

                    if (macro.type === 'ability-check') {
                        let actor = game.actors.entities.find(a => a.data.name === macro.actor.name);
                        if (macro.subtype === 'prompt') {
                            const dialog = new Dialog({
                                title: "Ability Checks",
                                content: this.constructor._abilities5ePromptTemplate
                            }, { width: 600 }).render(true);

                            setTimeout(() => {
                                ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach((abl) => {
                                    dialog.element.find('.'+abl).off('click').on('click', () => {
                                        dialog.close();
                                        actor.rollAbilityTest(abl);
                                    });
                                });
                                ['acr', 'ani', 'arc', 'ath', 'dec', 'his',
                                    'ins', 'itm', 'inv', 'med', 'nat', 'prc',
                                    'prf', 'per', 'rel', 'slt', 'ste', 'sur'].forEach((skl) => {
                                    dialog.element.find('.'+skl).off('click').on('click', () => {
                                        dialog.close();
                                        actor.rollSkill(skl);
                                    });
                                });
                            }, 10);
                        } else {
                            if (['str', 'dex', 'con', 'int', 'wis', 'cha'].indexOf(macro.subtype) >= 0) {
                                actor.rollAbilitySave(macro.subtype);
                            }
                            if (['acr', 'ani', 'arc', 'ath', 'dec', 'his',
                                    'ins', 'itm', 'inv', 'med', 'nat', 'prc',
                                    'prf', 'per', 'rel', 'slt', 'ste', 'sur'].indexOf(macro.subtype) >= 0) {
                                actor.rollSkill(macro.subtype);
                            }
                        }
                    }
                }
            })
        });
    }

    /**
     * Parse message content for custom macro syntax
     * @param content
     * @param actor
     * @param toolTips
     * @returns {Promise<any>}
     */
    parseMessageContent(content, actor, toolTips = true) {
        return new Promise((resolve, reject) => {
            this.parsePrompts(duplicate(content)).then((parsed) => {
                let message = this.parsePromptOptionReferences(parsed.message, parsed.references);
                if (actor) {
                    if (game.data.system.name === CONFIG.EnhancementSuite.settings.dnd5e) {
                        message = this.parseActor5eData(message, actor.name ? game.actors.entities.find(a => a.data.name === actor.name) : actor);
                    }
                }
                const parser = new InlineDiceParser(message);
                message = parser.parse(toolTips);
                message = this.parseRollReferences(message, parser);
                resolve(message);
            });
        });
    }

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
     * Create context menu for chat items
     * @param html
     */
    chatListeners(html) {
        /*new ContextMenu(html, ".damage-card", {
            "Apply Damage": {
                icon: '<i class="fas fa-user-minus"></i>',
                callback: event => this.applyDamage(event, 1)
            },
            "Apply Healing": {
                icon: '<i class="fas fa-user-plus"></i>',
                callback: event => this.applyDamage(event, -1)
            },
            "Double Damage": {
                icon: '<i class="fas fa-user-injured"></i>',
                callback: event => this.applyDamage(event, 2)
            },
            "Half Damage": {
                icon: '<i class="fas fa-user-shield"></i>',
                callback: event => this.applyDamage(event, 0.5)
            },
            "Apply Damage by Type": {
                icon: '<i class="fas fa-user"></i>',
                callback: event => this.applyDamageByType(event)
            }
        });*/
    }

    /**
     * Apply damage/healing to selected tokens
     * @param event
     * @param multiplier
     */
    applyDamage(event, multiplier) {
        let roll = $(event.currentTarget).parents('.damage-card'),
            value = Math.floor(this.getTotalDamage(roll) * multiplier);

        this.constructor.applyDamageAmount(value);
    }

    /**
     * Get total damage from .damage-card
     * @param chatCard
     * @returns {number}
     */
    getTotalDamage(chatCard) {
        let total = 0;
        const normaldamage = $(chatCard).find('normaldamage').text().match(/(\d+)/g) || [];
        total += normaldamage.reduce((total, dmg) => total + parseInt(dmg), 0);
        const criticaldamage = $(chatCard).find('.crit[open] criticaldamage').text().match(/(\d+)/g) || [];
        total += criticaldamage.reduce((total, dmg) => total + parseInt(dmg), 0);
        return total;
    }

    /**
     * Apply damage by type to selected tokens
     * @param event
     */
    applyDamageByType(event) {
        const roll = $(event.currentTarget).parents('.damage-card');
        let types = this.getTotalDamageByType(roll);
        this.promptDamageTypes(types.reverse());
    }

    /**
     * Prompt user preference for each damage type in .damage-card
     * @param types
     */
    promptDamageTypes(types) {
        let dmg = types.pop();
        const d = new Dialog({
            title: 'Select Damage Method',
            content: '<h1 style="text-align: center;">'+dmg.amount+' '+dmg.type+'</h1>',
            buttons: {
                normal: {
                    icon: '',
                    label: 'Normal',
                    callback: () => {
                        this.constructor.applyDamageAmount(dmg.amount);
                        if (types.length > 0) this.promptDamageTypes(types);
                    }
                },
                immune: {
                    icon: '',
                    label: 'Immune',
                    callback: () => {
                        this.constructor.applyDamageAmount(0);
                        if (types.length > 0) this.promptDamageTypes(types);
                    }
                },
                resistant: {
                    icon: '',
                    label: 'Resistant',
                    callback: () => {
                        this.constructor.applyDamageAmount(Math.floor(dmg.amount * 0.5));
                        if (types.length > 0) this.promptDamageTypes(types);
                    }
                },
                vulnerable: {
                    icon: '',
                    label: 'Vulnerable',
                    callback: () => {
                        this.constructor.applyDamageAmount(dmg.amount * 2);
                        if (types.length > 0) this.promptDamageTypes(types);
                    }
                }
            }
        }).render(true);
    }

    /**
     * Get total damage by damage type in .damage-card
     * @param chatCard
     * @returns {Array}
     */
    getTotalDamageByType(chatCard) {
        const rgx = /(\d+) ?(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)?/gi;
        let types = [];

        const norm = $(chatCard).find('normaldamage').text().match(rgx);
        if (norm) {
            norm.forEach((dmg) => {
                const parts = dmg.split(' ');
                const t = types.find(type => type.type === (parts[1] || 'typeless'));
                if (t) {
                    t.amount += parseInt(parts[0]);
                } else {
                    types.push({ amount: parseInt(parts[0]), type: parts[1] || 'typeless' });
                }
            });
        }

        const crit = $(chatCard).find('.crit[open] criticaldamage').text().match(rgx);
        if (crit) {
            crit.forEach((dmg) => {
                const parts = dmg.split(' ');
                const t = types.find(type => type.type === (parts[1] || 'typeless'));
                if (t) {
                    t.amount += parseInt(parts[0]);
                } else {
                    types.push({ amount: parseInt(parts[0]), type: parts[1] || 'typeless' });
                }
            });
        }

        return types;
    }

    /**
     * Apply damage amount to selected tokens
     * @param value
     */
    static applyDamageAmount(value) {
        // Get tokens to which damage can be applied
        const tokens = canvas.tokens.controlledTokens.filter(t => {
            if ( t.actor && t.data.actorLink ) return true;
            else if ( t.data.bar1.attribute === "attributes.hp" || t.data.bar2.attribute === "attributes.hp" ) return true;
            return false;
        });
        if ( tokens.length === 0 ) return;

        // Apply damage to all tokens
        for ( let t of tokens ) {
            if ( t.actor && t.data.actorLink ) {
                let hp = parseInt(t.actor.data.data.attributes.hp.value),
                    max = parseInt(t.actor.data.data.attributes.hp.max);
                t.actor.update({"data.attributes.hp.value": Math.clamped(hp - value, 0, max)}, true);
            }
            else {
                let bar = (t.data.bar1.attribute === "attributes.hp") ? "bar1" : "bar2";
                t.update({[`${bar}.value`]: Math.clamped(t.data[bar].value - value, 0, t.data[bar].max)}, true);
            }
        }
    }

    /**
     * Parse references to named rolls
     * @param message
     * @param parser
     * @returns {String} - parsed message
     */
    parseRollReferences(message, parser) {
        const rolls = Object.keys(parser).filter(key => key.indexOf('_ref') >= 0);
        const m = message.match(/@{(?<id>[^\|}]+)(\|(?<print>[^\|}]+))?(\|(?<options>([^\|}]+(\|)?)+))?}/i);
        if (!m) {
            return message;
        } else {
            const id = m.groups.id;
            const print = m.groups.print || 'result';
            const options = (m.groups.options || '').split('|');

            // console.log(id, print, options);

            if (id.length > 0) {
                const rollKey = rolls.find(key => id+'_ref');
                if (rollKey) {
                    const roll = duplicate(parser[id+'_ref']);
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

            return this.parseRollReferences(message, parser);
        }
    }

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

    /**
     * @param {String} message - the message to be parsed
     * @param {*} resolve - the resolve callback for the promise
     * @param {Object} parsed - previously parsed queries
     */
    parsePromptTags(message, resolve, parsed = {}) {
        const rgx = "\\?{(?!:)(\\[(?<listType>(list|checkbox|radio))(?<optionDelimiter>\\|([^\\]]+)?)?\\])?(?<query>[^\\|}]+)\\|?(?<list>(([^,{}\\|]|{{[^}]+}})+,([^\\|{}]|{{[^}]+}})+\\|?)+)?(?<defaultValue>([^{}]|{{[^}]+}})+)?}"
        const p = message.match(new RegExp(rgx, 'i'));
        if (!p) {
            game.settings.set(game.data.system.name, 'promptOptionsMemory', JSON.stringify(this.optMemory));
            resolve({message: message, references: parsed});
        } else {
            const tag = p[0];

            if(!this.optMemory[tag]) this.optMemory[tag] = {};

            const listType = p.groups.listType || 'list';
            const query = p.groups.query.trim();
            const list = p.groups.list;
            const defaultValue = p.groups.defaultValue;
            const optionDelimiter = (p.groups.optionDelimiter || '|, ').substr(1);

            if (list) {
                let html = '<p>'+query+'</p>';
                let inputTag = '';
                if (listType === 'list') {
                    inputTag = '.list-prompt[query="'+query.replace(/"/g, '\\"')+'"]';

                    html += '<p><select class="list-prompt" query="'+query.replace(/"/g, '\\"')+'">';
                    list.split('|').forEach((listItem) => {
                        const parts = listItem.split(',');
                        const liLabel = parts[0].trim();
                        const selected = this.optMemory[tag].value === parts.slice(1).join(',').trim().replace(/"/g, '\\"');
                        html += '<option value="'+parts.slice(1).join(',').trim().replace(/"/g, '\\"')+'" '+(selected ? 'selected': '')+'>'+parts[0].trim()+'</option>';
                    });
                    html += '</select></p>';
                } else if (listType === 'checkbox' || listType === 'radio') {
                    inputTag = '.list-prompt';

                    html += '<form class="list-prompt">';
                    list.split('|').forEach((listItem) => {
                        const parts = listItem.split(',');
                        const liLabel = listType === 'checkbox' ? parts[0].trim().replace(/"/g, '\\"') : query;
                        const checked = this.optMemory[tag][liLabel] === parts.slice(1).join(',');
                        html += '<p><label><input type="'+listType+'" name="'+liLabel+'" value="'+parts.slice(1).join(',').trim().replace(/"/g, '\\"')+'" '+(checked ? 'checked': '')+' /> '+parts[0].trim()+'</label></p>'
                    });
                    html += '</form>';
                }

                if (parsed[query]) {
                    // Use previous input for repeated queries and selected options
                    this.parsePromptTags(message.replace(tag, parsed[query]), resolve, parsed);
                } else {
                    new Dialog({
                        title: "Macro Configuration",
                        content: html,
                        buttons: {
                            "ok": {
                                icon: '',
                                label: "OK",
                                callback: () => {
                                    if (listType === 'list') {
                                        const inputLabel = $(inputTag+' option:selected').html();
                                        const inputValue = $(inputTag+' option:selected').val();
                                        this.optMemory[tag].value = inputValue;
                                        parsed[inputLabel] = inputValue.split(',');
                                        parsed[query] = [inputValue.split(',')[0]];
                                        this.parsePromptTags(message.replace(tag, inputValue.split(',')[0]), resolve, parsed);
                                    } else if (listType === 'checkbox' || listType === 'radio') {
                                        const selected = [];
                                        list.split('|').forEach((listItem) => {
                                            const parts = listItem.split(',');
                                            const liLabel = listType === 'checkbox' ? parts[0].trim().replace(/"/g, '\\"') : query;
                                            if(listType === 'checkbox') delete this.optMemory[tag][liLabel];
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

    /**
     * Parse references to selected prompt options
     * @param message
     * @param parsed
     * @returns {String} - parsed message
     */
    parsePromptOptionReferences(message, parsed) {
        const p = message.match(/\?{:(?<query>[^\|}]+)\|?(?<defaultValue>([^{}]|{{[^}]+}})+)?}/i);
        if (!p) {
            return message;
        } else {
            const tag = p[0];
            const query = p.groups.query.trim();
            const defaultValue = p.groups.defaultValue || '1';

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

    /**
     * Parse actor data in a chat message
     * @param {String} message - message to be parsed
     * @param {Object} actor - an Actor5e entity
     * @returns {String} - parsed chat message
     *
     * @example
     * // Some examples of actor data include:
     * {{name}}
     * {{level}}
     * {{class1}}
     * {{class1.subclass}}
     *
     * @see Visit the [Github repository]{@link https://github.com/sillvva/foundry-vtt-modules/tree/master/fvtt-enhancement-suite} for all options
     */
    parseActor5eData(message, actor) {
        const actorInfo = this._getActorDataPieces(actor);
        let messageTags = message.match(new RegExp("{{(?<tags>[^}]*)}}", "gi"));
        if (!messageTags) return message;
        messageTags.forEach((tag) => {
            let tagName = tag.replace(/{{|}}/g,'');
            if (!actorInfo.find(info => info.name === tagName)) return;
            message = message.replace(tag, actorInfo.find(info => info.name === tagName).value);
        });
        return message;
    }

    /**
     * Take actor data and return name/value pairs that can be parsed from a macro
     * @param {Object} actor - the Actor entity
     * @returns {Object} - an amended array of name/value pairs
     * @private
     */
    _getActorDataPieces(actor) {
        let actorInfo = duplicate(this._parseActorSubdata(actor.data.data, 'data'));
        actorInfo.push({ name: 'name', value: actor.data.name });
        actorInfo = actorInfo.map(field => {
            field.name = field.name.replace(/data\.((details|attributes|resources|spells|traits|abilities)\.)?|\.value/gi, '');
            if (CONFIG.EnhancementSuite.actorDataReplacements[field.name]) {
                field.name = CONFIG.EnhancementSuite.actorDataReplacements[field.name];
            }
            return field;
        }).filter(field => {
            return ['biography', 'speed'].indexOf(field.name) < 0 && field.name.indexOf('skills.') < 0;
        });
        if (game.data.system.name === CONFIG.EnhancementSuite.settings.dnd5e) {
            actor.data.items.filter(item => item.type === 'class').forEach((item, i) => {
                actorInfo.push({ name: 'class'+(i+1), value: item.name });
                actorInfo.push({ name: 'class'+(i+1)+'.subclass', value: item.data.subclass.value });
                actorInfo.push({ name: 'class'+(i+1)+'.level', value: item.data.levels.value });
            });
        }
        return actorInfo;
    }

    /**
     * Iterate through the actor data to get name/value pairs
     * @param {Object | String} data - actor data being looped through
     * @param key
     * @returns {Object} - an array of name/value pairs
     * @private
     */
    _parseActorSubdata(data, key) {
        if (typeof data === 'object' && data != null) {
            let info = [];
            Object.keys(data).forEach(nextkey => {
                if (typeof data[nextkey] !== 'object' && ['value', 'max', 'mod', 'save'].indexOf(nextkey) < 0) return;
                let subdata = this._parseActorSubdata(data[nextkey], key+'.'+nextkey);
                if (subdata.hasOwnProperty('name')) {
                    info.push(subdata);
                }
                else {
                    info = info.concat(subdata);
                }
            });
            return info;
        }
        else {
            return { name: key, value: data };
        }
    }

    /**
     * Iterate through the actor data to get name/value pairs
     * @param {Object | String} data - actor data being looped through
     * @param key
     * @returns {Object} - an array of name/value pairs
     * @private
     */
    _parseActorEntity(data, key) {
        if (typeof data === 'object' && data != null) {
            let info = {};
            Object.keys(data).forEach(nextkey => {
                let subdata = this._parseActorEntity(data[nextkey], key+'.'+nextkey);
                if (subdata.hasOwnProperty('name')) {
                    const name = subdata.name.replace('data.','');
                    const value = subdata.value;
                    info[name] = value;
                }
                else {
                    Object.keys(subdata).forEach(d => {
                        info[d] = subdata[d];
                    });
                }
            });
            return info;
        }
        else {
            return { name: key, value: data };
        }
    }

    /**
     * Getter for the module templates path
     */
    static get _templatePath() {
        return 'public/modules/fvtt-enhancement-suite/templates';
    }

    /**
     * Custom macro item template
     * @returns {string}
     */
    static get _macroItemTemplate() {
        return `<div class="macro">
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

    /**
     * Custom saving throw prompt
     * @returns {string}
     */
    static get _saves5ePromptTemplate() {
        return `<div class="saves-prompt">
            <button class="str">Strength</button>
            <button class="dex">Dexterity</button>
            <button class="con">Constitution</button>
            <button class="int">Intelligence</button>
            <button class="wis">Wisdom</button>
            <button class="cha">Charisma</button>
        </div>`;
    }

    /**
     * Custom ability check prompt
     * @returns {string}
     */
    static get _abilities5ePromptTemplate() {
        return `<div class="abilities-prompt">
            <button class="str">Strength</button>
            <button class="dex">Dexterity</button>
            <button class="con">Constitution</button>
            <button class="int">Intelligence</button>
            <button class="wis">Wisdom</button>
            <button class="cha">Charisma</button>
        </div>
        <hr />
        <div class="abilities-prompt">
            <button class="acr">Acrobatics</button>
            <button class="ani">Animal Handling</button>
            <button class="arc">Arcana</button>
            <button class="ath">Athletics</button>
            <button class="dec">Deception</button>
            <button class="his">History</button>
            <button class="ins">Insight</button>
            <button class="itm">Intimidation</button>
            <button class="inv">Investigation</button>
            <button class="med">Medicine</button>
            <button class="nat">Nature</button>
            <button class="prc">Perception</button>
            <button class="prf">Performance</button>
            <button class="per">Persuasion</button>
            <button class="rel">Religion</button>
            <button class="slt">Sleight of Hand</button>
            <button class="ste">Stealth</button>
            <button class="sur">Survival</button>
        </div>`;
    }

    /**
     * Get actor and macro data. Export them together
     * @param actor
     */
    exportActor(actor) {
        const data = this._parseActorEntity(actor.data, 'data');
        let actorEntity = {};
        for(let [key, val] of Object.entries(data)) {
            if(key.match(/permission\.|folder|token\.|_id/)) continue;
            actorEntity[key] = val;
        }

        let actorData = {
            macros: this.macros.filter(macro => macro.actor.id === actor._id || macro.actor === actor._id).map(macro => {
                macro.actor = { id: actor._id, name: actor.data.name };
                return macro;
            }),
            actor: actorEntity
        };

        const blob = new Blob([JSON.stringify(actorData)], { type: "application/json;charset=utf-8" });
        const fileURL = URL.createObjectURL(blob);
        const win = window.open();
        const element = win.document.createElement('a');
        $(element)
            .attr('href', fileURL)
            .attr('download', actor.data.name.replace(/[^_\-a-z0-9 ]/gi, '')+'.json');
        win.document.body.appendChild(element);
        element.click();
        win.close();
    }

    /**
     * Import .json file to actor
     * @param actor
     * @param data
     */
    importActor(actor, data) {
        if(!data.actor && !data.macros) throw "Invalid data imported";
        const obj = {};
        const s = {};
        const items = [];
        for (let [key, val] of Object.entries(data.actor)) {
            if(key.substr(0, 5) === 'items') {
                let iKey = key.replace('items.', '').split('.');
                const i = parseInt(iKey[0]);
                if (!items[i]) {
                    items[i] = {};
                }
                iKey = iKey.splice(1);
                iKey.reduce((t, e) => {
                    if (e === iKey.slice(-1)[0]) {
                        t[e] = val;
                    } else if(!t[e]) {
                        t[e] = {};
                    }
                    return t[e];
                }, items[i])
            } else {
                obj[key] = val;
            }
        }
        actor.update(obj, true);
        this.parseItems(actor, items);

        const macros = this.macros.filter(macro => macro.actor.name !== obj['name']).concat(data.macros.map(macro => {
            macro.actor = { id: actor._id, name: obj['name'] };
            return macro;
        }));
        game.settings.set(game.data.system.name, 'macros', JSON.stringify(macros));
    }

    /**
     * Parse actor items
     *
     * @param {Object} actorEntity - The Actor5e entity
     * @param {Number} items - an array of items being added
     * @param {Number} i - Optional. Leave blank on initial call.
     */
    parseItems(actorEntity, items, i = 0) {
        if(items == null) return;
        if(items.length === 0) return;

        let it = actorEntity.data.items.filter(item => {
            if(item.type === 'class') return item.name === items[i].name;
            if(item.type === 'weapon') return item.data.source.value === items[i].data.source.value;
            if(item.type === 'equipment') return item.data.source.value === items[i].data.source.value;
            if(item.type === 'backpack') return item.data.source.value === items[i].data.source.value;
            if(item.type === 'consumable') return item.data.source.value === items[i].data.source.value;
            if(item.type === 'tool') return item.data.source.value === items[i].data.source.value;
            if(item.type === 'spell') return item.data.source.value === items[i].data.source.value;
            return false;
        });
        if(it.length > 0) {
            actorEntity.updateOwnedItem(it, items[i]);
        }
        else {
            actorEntity.createOwnedItem(items[i], true);
        }

        if(items.length > i + 1) {
            setTimeout(() => {
                this.parseItems(actorEntity, items, i + 1);
            }, 100);
        }
    }

    /**
     * Data structure update for version 0.1.5 to version 0.2.0
     */
    _update015to020() {
        let updated = false;
        this.macros = this.macros.map(macro => {
            if (typeof macro.actor === 'string') {
                let actor = game.actors.entities.find(a => a._id === macro.actor);
                if (actor) {
                    macro.actor = { id: macro.actor, name: actor.data.name };
                    updated = true;
                }
            }
            return macro;
        });
        if (updated) {
            game.settings.set(game.data.system.name, 'macros', JSON.stringify(this.macros));
        }
        return updated;
    }
}

CONFIG.EnhancementSuite = {
    settings: {
        dnd5e: "dnd5e",
        pathfinder: "pathfinder"
    },
    actorDataReplacements: {
        'skills.acr.mod': 'acrobatics',
        'skills.ani.mod': 'animal-handling',
        'skills.arc.mod': 'arcana',
        'skills.ath.mod': 'athletics',
        'skills.dec.mod': 'deception',
        'skills.his.mod': 'history',
        'skills.ins.mod': 'insight',
        'skills.itm.mod': 'intimidation',
        'skills.inv.mod': 'investigation',
        'skills.med.mod': 'medicine',
        'skills.nat.mod': 'nature',
        'skills.prc.mod': 'perception',
        'skills.prf.mod': 'performance',
        'skills.per.mod': 'persuasion',
        'skills.rel.mod': 'religion',
        'skills.slt.mod': 'sleight-of-hand',
        'skills.ste.mod': 'stealth',
        'skills.sur.mod': 'survival',
        'di': 'damage-immunities',
        'dr': 'damage-resistances',
        'dv': 'damage-vulnerabilities',
        'ci': 'condition-immunities'
    },
    spellSchools: {
        'abj': 'Abjuration',
        'con': 'Conjuration',
        'div': 'Divination',
        'enc': 'Enchantment',
        'evo': 'Evocation',
        'ill': 'Illusion',
        'nec': 'Necromancy',
        'trs': 'Transmutation'
    }
};

let enhancementSuite = new EnhancementSuite();