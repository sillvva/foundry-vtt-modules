/**
 * Enhancement Suite
 * @author Matt DeKok <Sillvva>
 * @version 0.3.5
 */

class EnhancementSuite {

    constructor() {
        // Register hooks
        this.hookReady();
        this.hookToolbar();
        this.hookActorSheet();
        this.hookChat();
        this.hookMacros();
    }

    /**
     * Hook into the ready call for the VTT application
     */
    hookReady() {
        Hooks.on('ready', () => {
            game.macros = new Macros();

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

            this.toolbarCollapsed = game.settings.get("core", "sheetToolbarCollapsed");
        });
    }

    /**
     * Hook into the render call for the Actor5eSheet
     */
    hookActorSheet() {
        Hooks.on('renderActor5eSheet', (app, html, data) => {
            if (!data.owner) return;

            const windowContent = html.parent().parent();
            windowContent.addClass('actor-sheet');

            if (this.toolbarCollapsed) {
                windowContent.addClass('toolbar-collapsed');
            }

            const toolbar = $('<div class="actor-sheet-toolbar"><div class="toolbar-header">Toolbar</div><div class="toolbar-body"></div></div>');
            const toolbarBody = toolbar.find('.toolbar-body');

            windowContent.find('.actor-sheet-toolbar').remove();
            windowContent.prepend(toolbar);

            $('.actor-sheet-toolbar .toolbar-header').dblclick(() => {
                windowContent.toggleClass('toolbar-collapsed');
                this.toolbarCollapsed = !this.toolbarCollapsed;
                game.settings.set("core", "sheetToolbarCollapsed", this.toolbarCollapsed);
            });

            // Macro Configuration Button
            this.addToolbarButton(toolbarBody, 'far fa-keyboard', 'Macros', () => {
                new MacroConfig({
                    scope: 'actor',
                    actor: app.actor
                }, {
                    width: 650
                }).render(true);
            });

            Hooks.call('toolbarReady', toolbarBody, app.actor);
            Hooks.call('toolbar5eReady', toolbarBody, app.actor);
        });
    }

    /**
     * Hook into the render call for the ChatLog
     */
    hookChat() {
        $(document).arrive('.message', (el) => {
            new ContextMenu($(el), ".damage-card", {
                "Apply Damage": {
                    icon: '<i class="fas fa-user-minus"></i>',
                    callback: event => this.applyDamage($(el), 1)
                },
                "Apply Healing": {
                    icon: '<i class="fas fa-user-plus"></i>',
                    callback: event => this.applyDamage($(el), -1)
                },
                "Double Damage": {
                    icon: '<i class="fas fa-user-injured"></i>',
                    callback: event => this.applyDamage($(el), 2)
                },
                "Half Damage": {
                    icon: '<i class="fas fa-user-shield"></i>',
                    callback: event => this.applyDamage($(el), 0.5)
                },
                "Apply Damage by Type": {
                    icon: '<i class="fas fa-user"></i>',
                    callback: event => this.applyDamageByType($(el))
                }
            });
        });
    }

    /**
     * Hook into the render call for the Toolbar
     */
    hookToolbar() {
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
     * Hook into the Macro system
     */
    hookMacros() {
        SuiteHooks.on('parseMacrosAfterPrompts', (message, actor) => {
            if (actor && game.data.system.name === CONFIG.EnhancementSuite.settings.dnd5e) {
                message = this.parseActor5eData(message, actor.name ? game.actors.entities.find(a => a.data.name === actor.name) : actor);
            }
            return message;
        });
        Hooks.on('preRenderMacroConfig', (app, data) => {
            if (game.data.system.name === CONFIG.EnhancementSuite.settings.dnd5e) {
                if(data.scope === 'actor') {
                    const actor = data.actor;
                    const items = duplicate(actor.data.items);
                    const weapons = items.filter(item => item.type === 'weapon');
                    const spells = items.filter(item => item.type === 'spell').sort((a, b) => {
                        if (parseInt(a.data.level.value) === parseInt(b.data.level.value)) {
                            return a.name > b.name ? 1 : -1;
                        }
                        else {
                            return parseInt(a.data.level.value) - parseInt(b.data.level.value)
                        }
                    });
                    const tools = items.filter(item => item.type === 'tool');
                    const feats = items.filter(item => item.type === 'feat');

                    if (weapons.length > 0 || spells.length > 0) {
                        const weaponEntries = weapons.reduce((output, weapon) => {
                            weapon.enabled = game.macros.macros.find(macro => macro.type === 'weapon' && parseInt(macro.iid) === weapon.id);
                            let toHit = !isNaN(weapon.data.bonus.value) ? parseInt(weapon.data.bonus.value || 0) : 0;
                            toHit += weapon.data.proficient.value ? Math.floor((parseInt(actor.data.data.details.level.value) + 7) / 4) : 0;
                            toHit += Math.floor((parseInt(actor.data.data.abilities[weapon.data.ability.value].value) - 10) / 2);
                            weapon.data.hit = toHit;
                            weapon.data.damage.value = weapon.data.damage.value.replace('+0','');

                            output += `<div class="item weapon" data-weapon-id="${weapon.id}">
                                <div class="weapon-enable"><input type="checkbox" class="enable" `+(weapon.enabled ? 'checked' : '')+` /></div>
                                <div class="weapon-name">${weapon.name}</div>
                                <div class="weapon-range">${weapon.data.range.value}</div>
                                <div class="weapon-hit">${weapon.data.hit}</div>
                                <div class="weapon-damage">${weapon.data.damage.value}</div>
                            </div>`;
                            return output;
                        }, '');

                        const weaponsSection = `<div class="weapons-header">
                                <div class="weapon-enable">&nbsp;</div>
                                <div class="weapon-name">Weapon</div>
                                <div class="weapon-range">Range</div>
                                <div class="weapon-hit">To Hit</div>
                                <div class="weapon-damage">Damage</div>
                            </div>
                       `+weaponEntries;

                        const spellEntries = spells.reduce((output, spell) => {
                            spell.enabled = game.macros.macros.find(macro => macro.type === 'spell' && parseInt(macro.iid) === spell.id);
                            spell.school = CONFIG.EnhancementSuite.dnd5e.spellSchools[spell.data.school.value] || spell.data.school.value;

                            output += `<div class="item spell" data-spell-id="${spell.id}">
                                <div class="spell-enable"><input type="checkbox" class="enable" `+(spell.enabled ? 'checked' : '')+` /></div>
                                <div class="spell-name">${spell.name}</div>
                                <div class="spell-level">${spell.data.level.value}</div>
                                <div class="spell-school">${spell.school}</div>
                                <div class="spell-extra">&nbsp;</div>
                            </div>`;
                            return output;
                        }, '');

                        const spellsSection = `<div class="spells-header">
                                <div class="spell-enable">&nbsp;</div>
                                <div class="spell-name">Spell</div>
                                <div class="spell-level">Level</div>
                                <div class="spell-school">School</div>
                                <div class="spell-extra">&nbsp;</div>
                            </div>
                        `+spellEntries;

                        const tab = {
                            tabId: 'weaponsSpells',
                            tabName: 'Weapons & Spells',
                            flex: 2,
                            html: `<div class="macros">
                                `+weaponsSection+`
                                `+spellsSection+`
                            </div>`,
                        };

                        tab.onLoad = (html) => {
                            html.find('.weapon, .spell').off('click').on('click', (ev) => {
                                let el = $(ev.target).closest('.item').find('.enable').get(0);
                                el.checked = !el.checked;
                            });
                        };

                        tab.onSave = (html, macros) => {
                            if (weapons.length > 0) {
                                // Weapon Macros
                                const weaponEntries = html.find('.item.weapon');
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

                            if (spells.length > 0) {
                                // Spell Macros
                                const spellEntries = html.find('.item.spell');
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

                            return this.sortMacros(macros);
                        };

                        app.addTab(tab);
                    }

                    if (tools.length > 0) {
                        const toolEntries = tools.reduce((output, tool) => {
                            tool.enabled = game.macros.macros.find(macro => macro.type === 'tool' && parseInt(macro.iid) === tool.id);

                            output += `<div class="item tool" data-tool-id="${tool.id}">
                                <div class="tool-enable"><input type="checkbox" class="enable" `+(tool.enabled ? 'checked' : '')+` /></div>
                                <div class="tool-name">${tool.name}</div>
                            </div>`;
                            return output;
                        }, '');

                        const toolsSection = `<div class="tools-header">
                                <div class="spell-enable">&nbsp;</div>
                                <div class="spell-name">Tool</div>
                            </div>
                        `+toolEntries;

                        const tab = {
                            tabId: 'tools',
                            tabName: 'Tools',
                            html: `<div class="macros">
                                `+toolsSection+`
                            </div>`,
                        };

                        tab.onLoad = (html) => {
                            html.find('.tool').off('click').on('click', (ev) => {
                                let el = $(ev.target).closest('.item').find('.enable').get(0);
                                el.checked = !el.checked;
                            });
                        };

                        tab.onSave = (html, macros) => {
                            if (tools.length > 0) {
                                // Spell Macros
                                const toolEntries = html.find('.item.tool');
                                for(let i = 0; i < toolEntries.length; i++) {
                                    if (!$(toolEntries[i]).find('.enable').get(0).checked) continue;
                                    let label = $(toolEntries[i]).find('.tool-name').html();
                                    let sid = $(toolEntries[i]).attr('data-tool-id');
                                    macros.push({
                                        mid: macros.length,
                                        iid: parseInt(sid),
                                        type: 'tool',
                                        actor: { id: actor._id, name: actor.data.name },
                                        label: label
                                    });
                                }
                            }
                            return this.sortMacros(macros);
                        };

                        app.addTab(tab);
                    }

                    if (feats.length > 0) {
                        const featEntries = feats.reduce((output, feat) => {
                            feat.enabled = game.macros.macros.find(macro => macro.type === 'feat' && parseInt(macro.iid) === feat.id);

                            output += `<div class="item feat" data-feat-id="${feat.id}">
                                <div class="feat-enable"><input type="checkbox" class="enable" `+(feat.enabled ? 'checked' : '')+` /></div>
                                <div class="feat-name">${feat.name}</div>
                            </div>`;
                            return output;
                        }, '');

                        const featsSection = `<div class="feats-header">
                                <div class="spell-enable">&nbsp;</div>
                                <div class="spell-name">Tool</div>
                            </div>
                        `+featEntries;

                        const tab = {
                            tabId: 'feats',
                            tabName: 'Feats',
                            html: `<div class="macros">
                                `+featsSection+`
                            </div>`,
                        };

                        tab.onLoad = (html) => {
                            html.find('.feat').off('click').on('click', (ev) => {
                                let el = $(ev.target).closest('.item').find('.enable').get(0);
                                el.checked = !el.checked;
                            });
                        };

                        tab.onSave = (html, macros) => {
                            if (feats.length > 0) {
                                // Spell Macros
                                const featEntries = html.find('.item.feat');
                                for(let i = 0; i < featEntries.length; i++) {
                                    if (!$(featEntries[i]).find('.enable').get(0).checked) continue;
                                    let label = $(featEntries[i]).find('.feat-name').html();
                                    let sid = $(featEntries[i]).attr('data-feat-id');
                                    macros.push({
                                        mid: macros.length,
                                        iid: parseInt(sid),
                                        type: 'feat',
                                        actor: { id: actor._id, name: actor.data.name },
                                        label: label
                                    });
                                }
                            }
                            return this.sortMacros(macros);
                        };

                        app.addTab(tab);
                    }

                    if (true) {
                        let abilitySection = `<div class="ability-toggles">
                            <div class="enable-all">
                                <label>
                                    <input type="checkbox" class="prompt" name="Ability Checks" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'prompt') ? 'checked' : '')+`>
                                    Prompt (Creates one macro that prompts which abililty to use)
                                </label>
                            </div>
                            <div class="enable-one">
                                <label>
                                    <input type="checkbox" class="str" name="Strength Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'str') ? 'checked' : '')+`>
                                    Strength
                                </label>
                            </div>
                            <div class="enable-one">
                                <label>
                                    <input type="checkbox" class="dex" name="Dexterity Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'dex') ? 'checked' : '')+`>
                                    Dexterity
                                </label>
                            </div>
                            <div class="enable-one">
                                <label>
                                    <input type="checkbox" class="con" name="Constitution Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'con') ? 'checked' : '')+`>
                                    Constitution
                                </label>
                            </div>
                            <div class="enable-one">
                                <label>
                                    <input type="checkbox" class="int" name="Intelligence Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'int') ? 'checked' : '')+`>
                                    Intelligence
                                </label>
                            </div>
                            <div class="enable-one">
                                <label>
                                    <input type="checkbox" class="wis" name="Wisdom check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'wis') ? 'checked' : '')+`>
                                    Wisdom
                                </label>
                            </div>
                            <div class="enable-one">
                                <label>
                                    <input type="checkbox" class="cha" name="Charisma" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'cha') ? 'checked' : '')+`>
                                    Charisma
                                </label>
                            </div>
                        </div>`;

                        let skillSection = `<div class="enable-one">
                            <label>
                                <input type="checkbox" class="acr" name="Acrobatics Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'acr') ? 'checked' : '')+`>
                                Acrobatics
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="ani" name="Animal Handling Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ani') ? 'checked' : '')+`>
                                Animal Handling
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="arc" name="Arcana Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'arc') ? 'checked' : '')+`>
                                Arcana
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="ath" name="Athletics Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ath') ? 'checked' : '')+`>
                                Athletics
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="dec" name="Deception check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'dec') ? 'checked' : '')+`>
                                Deception
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="his" name="History" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'his') ? 'checked' : '')+`>
                                History
                            </label>
                        </div>`;
                        skillSection += `<div class="enable-one">
                            <label>
                                <input type="checkbox" class="ins" name="Insight Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ins') ? 'checked' : '')+`>
                                Insight
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="itm" name="Intimidation Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'itm') ? 'checked' : '')+`>
                                Intimidation
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="inv" name="Investigation Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'inv') ? 'checked' : '')+`>
                                Investigation
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="med" name="Medicine Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'med') ? 'checked' : '')+`>
                                Medicine
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="nat" name="Nature check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'nat') ? 'checked' : '')+`>
                                Nature
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="prc" name="Perception" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'prc') ? 'checked' : '')+`>
                                Perception
                            </label>
                        </div>`;
                        skillSection += `<div class="enable-one">
                            <label>
                                <input type="checkbox" class="prf" name="Performance Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'prf') ? 'checked' : '')+`>
                                Performance
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="per" name="Persuasion Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'per') ? 'checked' : '')+`>
                                Persuasion
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="rel" name="Religion Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'rel') ? 'checked' : '')+`>
                                Religion
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="slt" name="Sleight of Hand Check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'slt') ? 'checked' : '')+`>
                                Sleight of Hand
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="ste" name="Stealth check" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'ste') ? 'checked' : '')+`>
                                Stealth
                            </label>
                        </div>
                        <div class="enable-one">
                            <label>
                                <input type="checkbox" class="sur" name="Survival" `+(game.macros.macros.find(macro => macro.type === 'ability-check' && macro.subtype === 'sur') ? 'checked' : '')+`>
                                Survival
                            </label>
                        </div>`;

                        const tab = {
                            tabId: 'abilityChecks',
                            tabName: 'Ability Checks',
                            flex: 2,
                            html: `<div class="macros">
                                    `+abilitySection+`
                                <hr />
                                <div class="ability-toggles">
                                    `+skillSection+`
                                </div>
                            </div>`,
                        };

                        tab.onLoad = (html) => {};

                        tab.onSave = (html, macros) => {
                            // Ability Check Macros
                            const abilityEntries = html.find('.ability-toggles input[type="checkbox"]');
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
                            return this.sortMacros(macros);
                        };

                        app.addTab(tab);
                    }

                    if (true) {
                        const tab = {
                            tabId: 'savingThrows',
                            tabName: 'Saving Throws',
                            flex: 2,
                            html: `<div class="macros">
                                <div class="save-toggles">
                                    <div class="enable-all">
                                        <label>
                                            <input type="checkbox" class="prompt" name="Saving Throws" `+(game.macros.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'prompt') ? 'checked' : '')+`>
                                            Prompt (Creates one macro that prompts which abililty to use)
                                        </label>
                                    </div>
                                    <div class="enable-one">
                                        <label>
                                            <input type="checkbox" class="str" name="Strength Save" `+(game.macros.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'str') ? 'checked' : '')+`>
                                            Strength
                                        </label>
                                    </div>
                                    <div class="enable-one">
                                        <label>
                                            <input type="checkbox" class="dex" name="Dexterity Save" `+(game.macros.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'dex') ? 'checked' : '')+`>
                                            Dexterity
                                        </label>
                                    </div>
                                    <div class="enable-one">
                                        <label>
                                            <input type="checkbox" class="con" name="Constitution Save" `+(game.macros.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'con') ? 'checked' : '')+`>
                                            Constitution
                                        </label>
                                    </div>
                                    <div class="enable-one">
                                        <label>
                                            <input type="checkbox" class="int" name="Intelligence Save" `+(game.macros.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'int') ? 'checked' : '')+`>
                                            Intelligence
                                        </label>
                                    </div>
                                    <div class="enable-one">
                                        <label>
                                            <input type="checkbox" class="wis" name="Wisdom Save" `+(game.macros.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'wis') ? 'checked' : '')+`>
                                            Wisdom
                                        </label>
                                    </div>
                                    <div class="enable-one">
                                        <label>
                                            <input type="checkbox" class="cha" name="Charisma Save" `+(game.macros.macros.find(macro => macro.type === 'saving-throw' && macro.subtype === 'cha') ? 'checked' : '')+`>
                                            Charisma
                                        </label>
                                    </div>
                                </div>
                            </div>`,
                        };

                        tab.onLoad = (html) => {};

                        tab.onSave = (html, macros) => {
                            // Saving Throw Macros
                            const saveEntries = html.find('.save-toggles input[type="checkbox"]');
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
                            return this.sortMacros(macros);
                        };

                        app.addTab(tab);
                    }
                }
            }
        });
        Hooks.on('triggerMacro', (macro, actor) => {
            if (game.data.system.name === CONFIG.EnhancementSuite.settings.dnd5e) {
                if (macro.type === 'weapon') {
                    if (!actor) { ui.notifications.error('No actor selected'); return; }
                    let itemId = Number(macro.iid),
                        Item = CONFIG.Item.entityClass,
                        item = new Item(actor.data.items.find(i => i.id === itemId), actor);
                    game.macros.parse(item.data.data.description.value, actor).then(message => {
                        item.data.data.description.value = message;
                        item.roll();
                    });
                }

                if (macro.type === 'spell') {
                    if (!actor) { ui.notifications.error('No actor selected'); return; }
                    let itemId = Number(macro.iid),
                        Item = CONFIG.Item.entityClass,
                        item = new Item(actor.data.items.find(i => i.id === itemId), actor);
                    game.macros.parse(item.data.data.description.value, actor).then(message => {
                        item.data.data.description.value = message;
                        item.roll();
                    });
                }

                if (macro.type === 'tool') {
                    if (!actor) { ui.notifications.error('No actor selected'); return; }
                    let itemId = Number(macro.iid),
                        Item = CONFIG.Item.entityClass,
                        item = new Item(actor.data.items.find(i => i.id === itemId), actor);
                    game.macros.parse(item.data.data.description.value, actor).then(message => {
                        item.data.data.description.value = message;
                        item.roll();
                    });
                }

                if (macro.type === 'feat') {
                    if (!actor) { ui.notifications.error('No actor selected'); return; }
                    let itemId = Number(macro.iid),
                        Item = CONFIG.Item.entityClass,
                        item = new Item(actor.data.items.find(i => i.id === itemId), actor);
                    game.macros.parse(item.data.data.description.value, actor).then(message => {
                        item.data.data.description.value = message;
                        item.roll();
                    });
                }

                if (macro.type === 'saving-throw') {
                    if (!actor) { ui.notifications.error('No actor selected'); return; }
                    if (macro.subtype === 'prompt') {
                        const dialog = new Dialog({
                            title: "Saving Throw",
                            content: this.constructor._savesPromptTemplate(CONFIG.EnhancementSuite.settings.dnd5e)
                        }).render(true);

                        setTimeout(() => {
                            Object.keys(CONFIG.EnhancementSuite.dnd5e.abilities).forEach((abl) => {
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
                    if (!actor) { ui.notifications.error('No actor selected'); return; }
                    if (macro.subtype === 'prompt') {
                        const dialog = new Dialog({
                            title: "Ability Checks",
                            content: this.constructor._abilitiesPromptTemplate(CONFIG.EnhancementSuite.settings.dnd5e)
                        }, { width: 600 }).render(true);

                        setTimeout(() => {
                            Object.keys(CONFIG.EnhancementSuite.dnd5e.abilities).forEach((abl) => {
                                dialog.element.find('.'+abl).off('click').on('click', () => {
                                    dialog.close();
                                    actor.rollAbilityTest(abl);
                                });
                            });
                            Object.keys(CONFIG.EnhancementSuite.dnd5e.skills).forEach((skl) => {
                                dialog.element.find('.'+skl).off('click').on('click', () => {
                                    dialog.close();
                                    actor.rollSkill(skl);
                                });
                            });
                        }, 20);
                    } else {
                        if (Object.keys(CONFIG.EnhancementSuite.dnd5e.abilities).indexOf(macro.subtype) >= 0) {
                            actor.rollAbilityTest(macro.subtype);
                        }
                        if (Object.keys(CONFIG.EnhancementSuite.dnd5e.skills).indexOf(macro.subtype) >= 0) {
                            actor.rollSkill(macro.subtype);
                        }
                    }
                }
            }
        });
    }

    sortMacros(macros) {
        const sortOrder = ['weapon', 'spell', 'ability-check', 'saving-throw', 'tool', 'custom'];
        return macros.sort((a, b) => {
            if (a.actor.name !== b.actor.name) {
                return a.actor.name > b.actor.name ? 1 : -1
            }
            if (sortOrder.indexOf(a.type) !== sortOrder.indexOf(b.type)) {
                return sortOrder.indexOf(a.type) > sortOrder.indexOf(b.type) ? 1 : -1;
            }
        });
    }

    // TOOLBAR

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

    // SYSTEM MACROS

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
        const actorInfo = this._getActor5eDataPieces(actor);
        let messageTags = message.match(new RegExp("{{([^}]*)}}", "gi"));
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
    _getActor5eDataPieces(actor) {
        let actorInfo = duplicate(this._parseActor5eSubdata(actor.data.data, 'data'));
        actorInfo.push({ name: 'name', value: actor.data.name });
        actorInfo = actorInfo.map(field => {
            field.name = field.name.replace(/data\.((details|attributes|resources|spells|traits|abilities)\.)?|\.value/gi, '');
            if (game.data.system.name === CONFIG.EnhancementSuite.settings.dnd5e) {
                if (CONFIG.EnhancementSuite.dnd5e.actorDataReplacements[field.name]) {
                    field.name = CONFIG.EnhancementSuite.dnd5e.actorDataReplacements[field.name];
                }
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
    _parseActor5eSubdata(data, key) {
        if (typeof data === 'object' && data != null) {
            let info = [];
            Object.keys(data).forEach(nextkey => {
                if (typeof data[nextkey] !== 'object' && ['value', 'max', 'mod', 'save'].indexOf(nextkey) < 0) return;
                let subdata = this._parseActor5eSubdata(data[nextkey], key+'.'+nextkey);
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

    // DAMAGE CARD PARSING

    /**
     * Apply damage/healing to selected tokens
     * @param damageCard
     * @param multiplier
     */
    applyDamage(damageCard, multiplier) {
        const value = Math.floor(this.getTotalDamage($(damageCard)) * multiplier);
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
     * @param damageCard
     */
    applyDamageByType(damageCard) {
        let types = this.getTotalDamageByType(damageCard);
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
        let rgx = /(\d+) ?(bludgeoning|piercing|slashing)?/gi;
        if (game.data.system.name === CONFIG.EnhancementSuite.settings.dnd5e) {
            rgx = /(\d+) ?(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)?/gi;
        }
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

    // IMPORT/EXPORT

    /**
     * Get actor and macro data. Export them together
     * @param actor
     */
    exportActor(actor) {
        const data = this._parseActorEntity(actor.data, 'data');
        let actorEntity = {};
        let tokenData = {};
        for(let [key, val] of Object.entries(data)) {
            if(key.match(/permission\.|folder|_id/)) continue;
            if(key.match(/token\./)) {
                tokenData[key.replace('token.', '')] = val;
            } else {
                actorEntity[key] = val;
            }
        }

        let actorData = {
            actor: actorEntity,
            token: tokenData,
            macros: game.macros.macros.filter(macro => macro.actor.id === actor._id || macro.actor === actor._id).map(macro => {
                macro.actor = { id: actor._id, name: actor.data.name };
                return macro;
            })
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
        setTimeout(() => {win.close();}, 500);
    }

    /**
     * Import .json file to actor
     * @param actor
     * @param data
     */
    importActor(actor, data) {
        if(!data.actor) throw "Invalid data imported";

        const actorObj = {};
        const items = [];
        for (let [key, val] of Object.entries(data.actor)) {
            if (key.substr(0, 5) === 'items') {
                let iKey = key.replace('items.', '').split('.');
                const i = parseInt(iKey[0]);
                if (!items[i]) {
                    items[i] = {};
                }
                iKey = iKey.splice(1);
                iKey.reduce((t, e) => {
                    if (e === iKey.slice(-1)[0]) {
                        t[e] = val;
                    } else if (!t[e]) {
                        t[e] = {};
                    }
                    return t[e];
                }, items[i])
            } else {
                actorObj[key] = val;
            }
        }
        actor.update(actorObj, true);

        data.token.actorId = actor._id;
        data.token.effects = [];
        this._updateActorToken(actor, data.token);

        this.parseItems(actor, items);

        const macros = game.macros.macros.filter(macro => macro.actor.name !== actorObj['name']).concat(data.macros.map(macro => {
            macro.actor = { id: actor._id, name: actorObj['name'] };
            return macro;
        }));
        game.macros.save(macros);
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
     * Update all fields of a linked actor token
     * @param actor {Object}
     * @param tokenData {Object}    The new token data
     */
    _updateActorToken(actor, tokenData) {
        if ( !actor ) return;
        let actorData = {};

        // Only update certain default token fields
        let update = {};
        for ( let [k, v] of Object.entries(tokenData) ) {
            update[k] = v;
        }
        actorData['token'] = mergeObject(actor.token, update, {insertKeys: false, inplace: false});

        // Update linked attribute bar values
        for ( let bar of ["bar1", "bar2"].filter(b => tokenData[b+".attribute"]) ) {
            let attr = tokenData[bar+'.attribute'];
            if ( hasProperty(actor.data.data, attr) ) {
                actorData[`data.${attr}.value`] = tokenData[bar+'.value'];
                actorData[`data.${attr}.max`] = tokenData[bar+'.max'];
            }
        }

        // Update the Actor
        actor.update(actorData, true);
    }

    // TEMPLATES

    /**
     * Getter for the module templates path
     */
    static get _templatePath() {
        return 'public/modules/fvtt-enhancement-suite/templates';
    }

    /**
     * Custom saving throw prompt
     * @returns {string}
     */
    static _savesPromptTemplate(system) {
        return `<div class="saves-prompt">
            `+Object.entries(CONFIG.EnhancementSuite[system].saves).reduce((t, e) => {
            return t + '<button class="'+e[0]+'">'+e[1]+'</button>'
        }, '')+`
        </div>`;
    }

    /**
     * Custom ability check prompt
     * @returns {string}
     */
    static _abilitiesPromptTemplate(system) {
        return `<div class="abilities-prompt">
            `+Object.entries(CONFIG.EnhancementSuite[system].abilities).reduce((t, e) => {
                return t + '<button class="'+e[0]+'">'+e[1]+'</button>';
            }, '')+`
        </div>
        <hr />
        <div class="abilities-prompt">
            `+Object.entries(CONFIG.EnhancementSuite[system].skills).reduce((t, e) => {
            return t + '<button class="'+e[0]+'">'+e[1]+'</button>';
        }, '')+`
        </div>`;
    }
}

CONFIG.EnhancementSuite = {
    settings: {
        dnd5e: "dnd5e",
        pathfinder: "pathfinder"
    },
    dnd5e: {
        abilities: {
            'str': 'Strength',
            'dex': 'Dexterity',
            'con': 'Constitution',
            'int': 'Intelligence',
            'wis': 'Wisdom',
            'cha': 'Charisma'
        },
        saves: {
            'str': 'Strength',
            'dex': 'Dexterity',
            'con': 'Constitution',
            'int': 'Intelligence',
            'wis': 'Wisdom',
            'cha': 'Charisma'
        },
        skills: {
            'acr': 'Acrobatics',
            'ani': 'Animal Handling',
            'arc': 'Arcana',
            'ath': 'Athletics',
            'dec': 'Deception',
            'his': 'History',
            'ins': 'Insight',
            'itm': 'Intimidation',
            'inv': 'Investigation',
            'med': 'Medicine',
            'nat': 'Nature',
            'prc': 'Perception',
            'prf': 'Performance',
            'per': 'Persuasion',
            'rel': 'Religion',
            'slt': 'Sleight of Hand',
            'ste': 'Stealth',
            'sur': 'Survival'
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
        }
    }
};

let enhancementSuite = new EnhancementSuite();