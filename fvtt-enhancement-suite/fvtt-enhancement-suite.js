/**
 * Foundry VTT Enhancement Suite
 * @author Matt DeKok <Sillvva>
 * @version 0.1.5
 */

class FVTTEnhancementSuite extends Application {

    constructor(app) {
        super(app);

        this.hookReady();
        this.hookActor5eSheet();
        this.hookChat();
    }

    /**
     * Hook into the ready call for the VTT application
     */
    hookReady() {
        this.macros = [];
        Hooks.on('ready', () => {
            game.settings.register(game.data.system.name, "macros", {
                name: "Macros",
                hint: "Macros for quick access to chat commands",
                default: "[]",
                type: String,
                onChange: macros => {
                    this.macros = JSON.parse(macros);
                    if (game.data.system.name === 'dnd5e') {
                        this.renderMacro5eBar();
                    }
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

            this.optMemory = JSON.parse(game.settings.get(game.data.system.name, 'promptOptionsMemory'));
            this.macros = JSON.parse(game.settings.get(game.data.system.name, "macros"));
            if (game.data.system.name === 'dnd5e') {
                this.renderMacro5eBar();
            }
        });
    }

    /**
     * Hook into the render call for the Actor5eSheet
     */
    hookActor5eSheet() {
        Hooks.on('renderActor5eSheet', (app, html, data) => {
            if (!data.owner) return;

            const windowContent = html.parent();
            const toolbar = $('<div class="actor-sheet-toolbar"><div class="toolbar-header">Toolbar</div></div>');

            windowContent.find('.actor-sheet-toolbar').remove();
            windowContent.prepend(toolbar);

            // Macro Configuration Button
            let btnMacros = $('<button class="btn btn-small btn-dark btn-macros"><i class="far fa-keyboard"></i> Macros</button>');
            toolbar.find('.btn-macros').remove();
            toolbar.append(btnMacros);
            btnMacros.click((ev) => {
                ev.preventDefault();
                this.macro5eDialog(app.actor);
            });

            Hooks.call('toolbar5eReady', toolbar);
        });
    }

    /**
     * Hook into the render call for the ChatLog
     */
    hookChat() {
        Hooks.on('renderChatLog', (log, html, data) => this.chatListeners(html));
    }

    /**
     * Render the 5e macro configuration dialog box
     * @param {Object} actor - actor entity
     */
    macro5eDialog(actor) {
        if (!this.macros) return;
        const items = duplicate(actor.data.items);
        const data = {
            actor: actor,
            hasMacros: {
                weaponsSpells: items.filter(item => item.type === 'weapon' || item.type === 'spell').length > 0,
                weapons: items.filter(item => item.type === 'weapon').length > 0,
                spells: items.filter(item => item.type === 'spell').length > 0,
                tools: items.filter(item => item.type === 'tool').length > 0
            },
            macros: {
                weapons: items.filter(item => item.type === 'weapon')
                    .map(item => {
                        item.enabled = this.macros.find(macro => macro.type === 'weapon' && parseInt(macro.iid) === item.id) != null;

                        let toHit = !isNaN(item.data.bonus.value) ? parseInt(item.data.bonus.value || 0) : 0;
                        toHit += item.data.proficient.value ? Math.floor((parseInt(actor.data.data.details.level.value) + 7) / 4) : 0;
                        toHit += Math.floor((parseInt(actor.data.data.abilities[item.data.ability.value].value) - 10) / 2);
                        item.data.hit = toHit;

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
                        item.enabled = this.macros.find(macro => macro.type === 'spell' && parseInt(macro.iid) === item.id) != null;
                        item.school = CONFIG.FVTTEnhancementSuite.spellSchools[item.data.school.value] || item.data.school.value;
                        return item;
                    }),
                saves: {
                    prompt: this.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'prompt') || false,
                    str: this.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'str') || false,
                    dex: this.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'dex') || false,
                    con: this.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'con') || false,
                    int: this.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'int') || false,
                    wis: this.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'wis') || false,
                    cha: this.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'cha') || false
                },
                abilities: {
                    prompt: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'prompt') || false,
                    str: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'str') || false,
                    dex: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'dex') || false,
                    con: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'con') || false,
                    int: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'int') || false,
                    wis: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'wis') || false,
                    cha: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'cha') || false,
                    acr: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'acr') || false,
                    ani: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ani') || false,
                    arc: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'arc') || false,
                    ath: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ath') || false,
                    dec: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'dec') || false,
                    his: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'his') || false,
                    ins: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ins') || false,
                    itm: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'itm') || false,
                    inv: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'inv') || false,
                    med: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'med') || false,
                    nat: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'nat') || false,
                    prc: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'prc') || false,
                    prf: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'prf') || false,
                    per: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'per') || false,
                    rel: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'rel') || false,
                    slt: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'slt') || false,
                    ste: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ste') || false,
                    sur: this.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'sur') || false
                },
                tools: items.filter(item => item.type === 'tool')
                    .map(item => {
                        item.enabled = this.macros.find(macro => macro.type === 'tool' && parseInt(macro.iid) === item.id) != null;
                        return item;
                    }),
                custom: this.macros.filter(macro => macro.type === 'custom')
            }
        };
        renderTemplate(this._templatePath+'/macros/macro-5e-configuration.html', data).then(html => {
            const dialog = new Dialog({
                title: "Macro Configuration",
                content: html,
                buttons: {
                    "import": {
                        icon: '',
                        label: "Save",
                        callback: () => {
                            let macros = [];

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
                                    actor: actor._id,
                                    label: label
                                });
                            }

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
                                    actor: actor._id,
                                    label: label
                                });
                            }

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
                                    actor: actor._id,
                                    label: label
                                });
                            }

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
                                    actor: actor._id,
                                    label: label
                                });
                            }

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
                                    actor: actor._id,
                                    label: label
                                });
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
                                    actor: actor._id,
                                    label: label,
                                    content: content
                                });
                            }

                            console.log(macros);

                            game.settings.set("dnd5e", "macros", JSON.stringify(macros));
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
                    dialog.element.find('.tab[data-tab="custom"] .macros').append(this._macroItemTemplate);
                    this.addCustomMacroEventListeners(dialog);
                });

                dialog.element.find('.item[data-tab]').off('click').on('click', (ev) => {
                    dialog.element.find('.item, .tab').removeClass('active');

                    let tab = ev.target.attributes['data-tab'].value;
                    dialog.element.find('.item[data-tab="'+tab+'"]').addClass('active');
                    dialog.element.find('.tab[data-tab="'+tab+'"]').addClass('active');
                });

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
    renderMacro5eBar() {
        $('body .macro-bar').remove();
        if (this.macros.length > 0) {
            const data = {
                macros: this.macros
            };
            renderTemplate(this._templatePath+'/macros/macro-bar.html', data).then(html => {
                $('body').append(html);

                $('.macro-bar [data-macro-id]').click((ev) => {
                    const macroId = parseInt($(ev.target).attr('data-macro-id'));
                    const macro = this.macros.find(m => m.mid === macroId);

                    if (macro.type === 'custom') {
                        if (!macro.content) return;
                        this.parsePrompts(duplicate(macro.content)).then((parsed) => {
                            let message = parsed.message;
                            const references = parsed.references;
                            message = this.parsePromptOptionReferences(message, references);
                            message = this.parseActor5eData(message, game.actors.entities.find(actor => actor._id === macro.actor));
                            const parser = new InlineDiceParser(message);
                            message = parser.parse();
                            message = this.parseRollReferences(message, parser);
                            this.createMessage(message);
                        });
                    }

                    if (macro.type === 'weapon' || macro.type === 'spell') {
                        let actor = game.actors.entities.find(a => a._id === macro.actor).data;
                        let itemId = Number(macro.iid),
                            Item = CONFIG.Item.entityClass,
                            item = new Item(actor.items.find(i => i.id === itemId), actor);
                        item.roll();
                    }

                    if (macro.type === 'tool') {
                        let actor = game.actors.entities.find(a => a._id === macro.actor);
                        let itemId = Number(macro.iid),
                            Item = CONFIG.Item.entityClass,
                            item = new Item(actor.items.find(i => i.id === itemId), actor);
                        item.roll();
                    }

                    if (macro.type === 'saving-throw') {
                        let actor = game.actors.entities.find(a => a._id === macro.actor);
                        if (macro.subtype === 'prompt') {
                            const dialog = new Dialog({
                                title: "Saving Throw",
                                content: this._saves5ePromptHtml
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
                        let actor = game.actors.entities.find(a => a._id === macro.actor);
                        if (macro.subtype === 'prompt') {
                            const dialog = new Dialog({
                                title: "Ability Checks",
                                content: this._abilities5ePromptHtml
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
                })
            });
        }
    }

    /**
     * Create chat entry in ChatLog
     * @param message
     */
    createMessage(message) {
        const data = {
            user: game.user._id
        };
        let [chatType, rgx] = ChatLog.parse(message);
        if (data.content = rgx ? rgx[2] : message, "roll" === chatType) {
            let actorData = Roll._getActorData();
            return new Roll(rgx[2], actorData).toMessage()
        }
        if (["ic", "emote"].includes(chatType)) {
            let charName;
            if (game.user.character) charName = game.user.character.name;
            else if (game.user.isGM && canvas.ready) {
                let token = canvas.tokens.controlledTokens.find(t => void 0 !== t.actor);
                token && (charName = token.actor.name)
            }
            if (!charName) return;
            data.alias = charName;
            "emote" === chatType && (data.content = `${charName} ${data.content}`)
        }

        ChatMessage.create(data, !0);
    }

    /**
     * Create context menu for chat items
     * @param html
     */
    chatListeners(html) {
        new ContextMenu(html, ".damage-card", {
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
        });
    }

    /**
     * Apply damage/healing to selected tokens
     * @param event
     * @param multiplier
     */
    applyDamage(event, multiplier) {
        let roll = $(event.currentTarget).parents('.damage-card'),
            value = Math.floor(this.getTotalDamage(roll) * multiplier);

        this.applyDamageAmount(value);
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
                        this.applyDamageAmount(dmg.amount);
                        if (types.length > 0) this.promptDamageTypes(types);
                    }
                },
                immune: {
                    icon: '',
                    label: 'Immune',
                    callback: () => {
                        this.applyDamageAmount(0);
                        if (types.length > 0) this.promptDamageTypes(types);
                    }
                },
                resistant: {
                    icon: '',
                    label: 'Resistant',
                    callback: () => {
                        this.applyDamageAmount(Math.floor(dmg.amount * 0.5));
                        if (types.length > 0) this.promptDamageTypes(types);
                    }
                },
                vulnerable: {
                    icon: '',
                    label: 'Vulnerable',
                    callback: () => {
                        this.applyDamageAmount(dmg.amount * 2);
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
    applyDamageAmount(value) {
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
        if(!this.optMemory[rgx]) this.optMemory[rgx] = {};
        if (!p) {
            game.settings.set('dnd5e', 'promptOptionsMemory', JSON.stringify(this.optMemory));
            resolve({message: message, references: parsed});
        } else {
            const tag = p[0];
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
                        const selected = this.optMemory[rgx][query] === parts.slice(1).join(',').trim().replace(/"/g, '\\"');
                        console.log(liLabel, this.optMemory[rgx][query], parts.slice(1).join(',').trim().replace(/"/g, '\\"'));
                        html += '<option value="'+parts.slice(1).join(',').trim().replace(/"/g, '\\"')+'" '+(selected ? 'selected': '')+'>'+parts[0].trim()+'</option>';
                    });
                    html += '</select></p>';
                } else if (listType === 'checkbox' || listType === 'radio') {
                    inputTag = '.list-prompt';

                    html += '<form class="list-prompt">';
                    list.split('|').forEach((listItem) => {
                        const parts = listItem.split(',');
                        const liLabel = listType === 'checkbox' ? parts[0].trim().replace(/"/g, '\\"') : query;
                        const checked = this.optMemory[rgx][liLabel] === parts.slice(1).join(',');
                        if(listType === 'checkbox') delete this.optMemory[rgx][liLabel];
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
                                        this.optMemory[rgx][query] = inputValue;
                                        parsed[inputLabel] = inputValue.split(',');
                                        parsed[query] = [inputValue.split(',')[0]];
                                        this.parsePromptTags(message.replace(tag, inputValue.split(',')[0]), resolve, parsed);
                                    } else if (listType === 'checkbox' || listType === 'radio') {
                                        const selected = [];
                                        $(inputTag).serializeArray().forEach(item => {
                                            selected.push(item.value.split(',')[0]);
                                            parsed[item.name] = item.value.split(',');
                                            this.optMemory[rgx][item.name] = item.value;
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
            if (CONFIG.FVTTEnhancementSuite.actorDataReplacements[field.name]) {
                field.name = CONFIG.FVTTEnhancementSuite.actorDataReplacements[field.name];
            }
            return field;
        }).filter(field => {
            return ['biography', 'speed'].indexOf(field.name) < 0 && field.name.indexOf('skills.') < 0;
        });
        if (game.data.system.name === 'dnd5e') {
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
     * @returns {Object} - an array of name/value pairs
     * @private
     */
    _parseActorSubdata(data, key) {
        if (typeof data === 'object') {
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
     * Getter for the module templates path
     */
    get _templatePath() {
        return 'public/modules/fvtt-enhancement-suite/templates';
    }

    /**
     * Custom macro item template
     * @returns {string}
     */
    get _macroItemTemplate() {
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
                    <textarea name="content" name="content"></textarea>
                </div>
            </div>
        </div>`;
    }

    /**
     * Custom saving throw prompt
     * @returns {string}
     */
    get _saves5ePromptHtml() {
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
    get _abilities5ePromptHtml() {
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
}

CONFIG.FVTTEnhancementSuite = {
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

let enhancementSuite = new FVTTEnhancementSuite();
enhancementSuite.render();
