/**
 * @author Matt DeKok <Sillvva>
 * @version 0.1.3
 */

class BeyondImporter extends Application {

    constructor(app) {
        super(app);

        this.hookActorSheet();
        this.hookActorList();
        this.hookToolbar5eReady();
    }

    /**
     * Hook into the render call for the Actor5eSheet to add an extra button
     */
    hookActorSheet() {
        Hooks.on('renderActor5eSheet', (app, html, data) => {
            // check existence of Enhancement Suite
            if($('.actor-sheet-toolbar').length > 0) return;
            if(!data.owner) return;

            const windowHeader = html.parent().parent().find('.window-header');
            const windowCloseBtn = windowHeader.find('.close');
            const importButton = $('<a class="import-dndbeyond-sheet"><span class="fas fa-file-import"></span> Beyond Import</a>');

            windowHeader.find('.import-dndbeyond-sheet').remove();
            windowCloseBtn.before(importButton);

            // Handle button clicks
            importButton.click(ev => {
                ev.preventDefault();
                this.importDialog({ actor: app.actor });
            });
        });
    }

    /**
     * Hook into the render call for the ActorList to add an extra button
     */
    hookActorList() {
        Hooks.on('renderActorList', (app, html, data) => {
            const importButton = $('<button class="import-dndbeyond-list" style="min-width: 96%;"><span class="fas fa-file-import"></span> Beyond Import</button>');

            html.find('.import-dndbeyond-list').remove();
            html.find('.directory-footer').append(importButton);

            // Handle button clicks
            importButton.click(ev => {
                ev.preventDefault();
                this.importDialog({ actor: null });
            });
        });
    }

    /**
     * Hook into the render call for the Enhancement Suite's toolbar5eReady to add an extra button
     */
    hookToolbar5eReady() {
        Hooks.on('toolbar5eReady', (html) => {
            const importButton = $('<button class="btn btn-small btn-dark import-dndbeyond-sheet" style="min-width: 96%;"><span class="fas fa-file-import"></span> D&D Beyond<br>Character Import</button>');

            $('.import-dndbeyond-sheet').remove();
            html.find('.btn-macros').after(importButton);

            // Handle button clicks
            importButton.click(ev => {
                ev.preventDefault();
                this.importDialog({ actor: null });
            });
        });
    }

    /**
     * Render the import dialog
     *
     * @param {Object} options - Options to modify the import behavior
     *
     * @example
     * // Creates a new actor entity
     * importCharacterData({ actor: null });
     *
     * @example
     * // Also creates a new actor entity
     * importCharacterData();
     *
     * @example
     * // Assign existing actor entity
     * // Actor5e is defined as an instance of the Actor5e class
     * importCharacterData({ actor: Actor5e });
     */
    importDialog(options = {}) {
        let out = '';

        out += '<p>Follow these instructions to get your character data from D&amp;D Beyond.</p>';
        out += '<ol>';
        out += '<li>Open your character sheet (not the builder) in D&amp;D Beyond.</li>';
        out += '<li>In your address bar, append <strong>/json</strong> to the end of the URL. It should look like this:<br /><small><em>https://www.dndbeyond.com/profile/username/characters/1234567<strong>/json</strong></em></small></li>';
        out += '<li>Copy the data on this page into the box below.</li>';
        out += '</ol>';
        out += '<p><textarea class="ddb-data form-control" cols="30" rows="5" autofocus placeholder="Paste your character data here"></textarea></p>';

        // console.log(options.actor);

        const d = new Dialog({
            title: "D&D Beyond Character Import",
            content: out,
            buttons: {
                "import": {
                    icon: '',
                    label: "Import",
                    callback: (e) => {
                        const characterData = document.querySelector('.ddb-data').value;
                        this.importCharacterData(characterData, options);
                    }
                },
                "cancel": {
                    icon: '',
                    label: "Cancel",
                    callback: () => {}
                }
            }
        });
        d.render(true);
    }

    /**
     * Import character data and create or get the actor and pass the data to the parser
     *
     * @param {String} characterData - Character JSON data string copied from the D&D Beyond website
     * @param {Object} options - Options to modify the import behavior
     */
    importCharacterData(characterData, options) {
        // Merge options and defaults
        const defaults = {
            actor: null
        };
        let opts = Object.assign(defaults, options);

        // Check data integrity
        let data = null;
        try {
            data = JSON.parse(characterData);
        }
        catch(e) {
            console.error('Unable to parse invalid character data');
            console.error(e.message);
            return;
        }

        if (data == null) {
            console.error('No character data provided');
            return;
        }

        // Create new actor (GM only) if entity is not pre-defined
        if(opts.actor == null) {
            Actor5e.create({ name: data.character.name, type: 'character' }, true).then(actor => {
                this.parseCharacterData(actor, data.character);
            });
        } else {
            this.parseCharacterData(opts.actor, data.character);
        }
    }

    /**
     * Parse character data into the actor sheet
     *
     * @param {String} actorEntity - The Actor5e entity that will be updated with the new data
     * @param {Object} data - Character JSON data string parsed as an object after import
     */
    parseCharacterData(actorEntity, character) {
        // console.log(character);
        let actor = Object.assign({}, actorEntity.data);
        // delete actor._id;

        let items = [];

        let features = this.getFeatures(character);
        let classSpells = features.spells;
        let biography = features.biography;

        let obj = {};

        obj['img'] = character.avatarUrl;
        obj['name'] = character.name;

        // Set Details
        obj['data.details.level.value'] = features.level;
        obj['data.details.race.value'] = (character.race.subRaceShortName == null || character.race.subRaceShortName === '' ? '' : character.race.subRaceShortName+' ')+character.race.baseName;
        if (character.alignmentId != null) obj['data.details.alignment.value'] = this._getConfig('alignments', 'id', character.alignmentId).long;
        obj['data.details.background.value'] = character.background.definition != null ? character.background.definition.name : (character.background.customBackground != null ? character.background.customBackground.name : '');
        obj['data.details.xp.value'] = character.currentXp.toString();
        obj['data.details.biography.value'] = biography;

        // Set Attributes
        obj['data.attributes.prof.value'] = Math.floor((features.level + 7) / 4);
        obj['data.attributes.hd.value'] = features.level;
        obj['data.attributes.hp.value'] = this.getHp(character).toString();
        obj['data.attributes.hp.max'] = this.getHp(character).toString();
        obj['data.attributes.spellcasting.value'] = '';
        obj['data.attributes.speed.value'] = this.getSpeeds(character);

        let inv = this.getInventory(character, actorEntity, features);
        items = items.concat(inv.items);
        obj['data.attributes.ac.value'] = inv.ac;

        // Set Traits
        obj['data.traits.size.value'] = character.race.size;
        obj['data.traits.languages.value'] = this.getLanguages(character).join(', ');
        obj['data.traits.senses.value'] = this.getSenses(character).join(', ');

        // Set Resistances, Immunities, Vulnerabilities
        const defenses = this.getDefemseAdjustments(character);
        obj['data.traits.ci.value'] = defenses.conditionImmunities.join(', ');
        obj['data.traits.di.value'] = defenses.damageImmunities.join(', ');
        obj['data.traits.dr.value'] = defenses.resistances.join(', ');
        obj['data.traits.dv.value'] = defenses.vulnerabilities.join(', ');

        // Set Currency
        obj['data.currency.cp.value'] = character.currencies.cp;
        obj['data.currency.sp.value'] = character.currencies.sp + 5 * character.currencies.ep;
        obj['data.currency.gp.value'] = character.currencies.gp;
        obj['data.currency.pp.value'] = character.currencies.pp;

        // Set Abilities
        for (let abl in actor.data.abilities) {
            const ability = actor.data.abilities[abl];
            const profs = [];
            for (let modType in character.modifiers) {
                character.modifiers[modType].filter((mod) => {
                    return mod.type === 'proficiency' && mod.subType === ability.label.toLowerCase().replace(/ /g, '-')+'-saving-throws' && mod.isGranted;
                }).forEach((mod) => {
                    profs.push(mod);
                });
            }
            if (profs.length > 0) { obj['data.abilities.'+abl+'.proficient'] = '1'; }
            else { obj['data.abilities.'+abl+'.proficient'] = '0'; }

            obj['data.abilities.'+abl+'.value'] = this.getTotalAbilityScore(character, this._getConfig('abilities', 'short', abl).id).toString();
            obj['data.abilities.'+abl+'.min'] = 0;
            obj['data.abilities.'+abl+'.mod'] = Math.floor((obj['data.abilities.'+abl+'.value'] - 10) / 2);
            obj['data.abilities.'+abl+'.save'] = Math.floor((obj['data.abilities.'+abl+'.value'] - 10) / 2);

            if(obj['data.abilities.'+abl+'.proficient'] === '1') {
                obj['data.abilities.'+abl+'.save'] += obj['data.attributes.prof.value'];
            }
        }

        let resources = 0;
        const resourceTypes = ['primary', 'secondary'];
        // Set Class Levels, Spellcasting Ability
        character.classes.forEach((charClass) => {
            const item = {
                img: 'icons/mystery-man.png',
                name: charClass.definition.name,
                type: 'class',
                data: {
                    description: { type: "String", label: "Description", value: "" },
                    levels: { type: "String", label: "Class Levels", value: charClass.level.toString() },
                    source: { type: "String", label: "Source" },
                    subclass: { type: "String", label: "Subclass", value: charClass.subclassDefinition == null ? '' : charClass.subclassDefinition.name }
                }
            };

            items = items.concat([item]);

            if (obj['data.attributes.spellcasting.value'] === '') {
                if (charClass.spellCastingAbilityId != null) {
                    obj['data.attributes.spellcasting.value'] = this._getConfig('abilities', 'id', charClass.spellCastingAbilityId).short;
                } else if (charClass.subclassDefinition != null) {
                    if (charClass.subclassDefinition.spellCastingAbilityId != null) {
                        obj['data.attributes.spellcasting.value'] = this._getConfig('abilities', 'id', charClass.subclassDefinition.spellCastingAbilityId).short;
                    }
                }

                if(obj['data.attributes.spellcasting.value'] !== '') {
                    obj['data.attributes.spelldc.value'] = 8 + parseInt(obj['data.attributes.prof.value']) + parseInt(obj['data.abilities.'+obj['data.attributes.spellcasting.value']+'.mod']);
                }
            }

            charClass.classFeatures
                .filter(feature => feature.definition.limitedUse.length > 0)
                .filter(feature => feature.definition.limitedUse[0].uses > 1)
                .forEach(feature => {
                    if(resources < 2) {
                        let limitedUses = feature.definition.limitedUse;
                        if (limitedUses[0].level == null) {
                            obj['data.resources.'+resourceTypes[resources]+'.label'] = feature.definition.name;
                            obj['data.resources.'+resourceTypes[resources]+'.value'] = limitedUses[0].uses;
                            obj['data.resources.'+resourceTypes[resources]+'.max'] = limitedUses[0].uses;
                        } else {
                            limitedUses = limitedUses.filter(lu => lu.level != null && lu.level <= charClass.level).pop();
                            obj['data.resources.'+resourceTypes[resources]+'.label'] = feature.definition.name;
                            obj['data.resources.'+resourceTypes[resources]+'.value'] = limitedUses.uses;
                            obj['data.resources.'+resourceTypes[resources]+'.max'] = limitedUses.uses;
                        }
                        resources++;
                    }
                });
        });

        // Set Skills / Passive Perception
        for (let skl in actor.data.skills) {
            let skill = actor.data.skills[skl];
            const skillData = this._getObjects(character, 'friendlySubtypeName', skill.label);
            const prof = skillData.filter(sp => sp.type === 'proficiency').length > 0;
            const exp = skillData.filter(sp => sp.type === 'expertise').length > 0;
            const bonus = skillData.filter(sb => sb.type === 'bonus').reduce((total, skillBon) => {
                let bon = 0;
                if (skillBon.value != null) {
                    bon = skillBon.value;
                } else if (skillBon.statId != null) {
                    bon = obj['data.abilities'+this._getConfig('abilities', 'id', skillBon.statId).short+'.mod'];
                }
                return total + bon;
            }, 0) + (prof ? obj['data.attributes.prof.value'] + (exp ? obj['data.attributes.prof.value'] : 0) : 0);

            skill.value = (prof ? 1 + (exp ? 1 : 0) : 0);
            skill.mod = obj['data.abilities.'+skill.ability+'.mod'] + bonus;

            // passive perception
            if(skill.label === 'Perception') {
                obj['data.traits.perception.value'] = 10 + skill.mod;
            }

            for(let key in skill) {
                obj['data.skills.'+skl+'.'+key] = skill[key];
            }
        }

        // Set Spells
        classSpells.forEach((spell) => {
            let duration = 'Instantaneous';
            let concentration = false;
            if (spell.definition.duration.durationType !== 'Instantaneous') {
                concentration = spell.definition.duration.durationType === 'Concentration';
                duration = spell.definition.duration.durationInterval+' '+spell.definition.duration.durationUnit+(spell.definition.duration.durationInterval === 1 ? '' : 's');
            }

            let spellType = 'utility';
            let damage = '';
            let damageType = '';
            if (spell.definition.requiresSavingThrow) {
                spellType = 'save';
            } else if (spell.definition.tags.indexOf('Healing') >= 0) {
                spellType = 'heal';
                damageType = 'healing';
                const spellMod = spell.definition.modifiers.find(mod => mod.type === 'bonus' && mod.subType == 'hit-points');
                if(spellMod != null) {
                    if (spellMod.die.diceCount > 0) {
                        damage += spellMod.die.diceString;
                    }
                    if (spellMod.die.fixedValue) {
                        damage += (damage === '' ? '' : '+')+spellMod.die.fixedValue;
                    }
                    if (spellMod.usePrimaryStat) {
                        const abl = Math.floor((this.getTotalAbilityScore(character, spell.spellCastingAbilityId) - 10) / 2);
                        damage += (damage === '' ? '' : (abl >= 0 ? '+' : '-'))+Math.abs(abl);
                    }
                }
            } else if (spell.definition.requiresAttackRoll) {
                spellType = 'attack';
                const spellMod = spell.definition.modifiers.find(mod => mod.type === 'damage');
                damageType = spellMod.subType;
                if(spellMod != null) {
                    if (spellMod.die.diceCount > 0) {
                        damage += spellMod.die.diceString;
                    }
                    if (spellMod.die.fixedValue) {
                        damage += (damage === '' ? '' : '+')+spellMod.die.fixedValue;
                    }
                    if (spellMod.usePrimaryStat) {
                        const abl = Math.floor((this.getTotalAbilityScore(character, spell.spellCastingAbilityId) - 10) / 2);
                        damage += (damage === '' ? '' : (abl >= 0 ? '+' : '-'))+Math.abs(abl);
                    }
                }
            }

            let spellItem = {
                name: spell.definition.name,
                type: "spell",
                img: 'icons/mystery-man.png',
                data: {
                    ability: {type: "String", label: "Spellcasting Ability", value: this._getConfig('abilities', 'id', spell.spellCastingAbilityId).short},
                    components: {type: "String", label: "Spell Components", value: spell.definition.components.map(comp => this._getConfig('spellComponents', 'id', comp).short).join(', ')},
                    concentration: {type: "Boolean", label: "Requires Concentration", value: concentration},
                    damage: {type: "String", label: "Spell Damage", value: damage},
                    damageType: {type: "String", label: "Damage Type", value: damageType},
                    description: {type: "String", label: "Description", value: spell.definition.description},
                    duration: {type: "String", label: "Duration", value: duration},
                    level: {type: "Number", label: "Spell Level", value: spell.definition.level},
                    materials: {type: "String", label: "Materials", value: spell.definition.componentsDescription},
                    range: {type: "String", label: "Range", value: spell.definition.range.rangeValue+' ft.'},
                    ritual: {type: "Boolean", label: "Cast as Ritual", value: spell.definition.ritual},
                    save: {type: "String", label: "Saving Throw", value: spell.definition.saveDcAbilityId == null ? '' :this._getConfig('abilities', 'id', spell.definition.saveDcAbilityId).short},
                    school: {type: "String", label: "Spell School", value: spell.definition.school === 'Transmutation' ? 'trs' : spell.definition.school.toLowerCase().substring(0, 3)},
                    source: {type: "String", label: "Source", value: spell.id.toString()},
                    spellType: {type: "String", label: "Spell Type", value: spellType},
                    target: {type: "String", label: "Target", value: ""},
                    time: {type: "String", label: "Casting Time", value: spell.definition.activation.activationTime+' '+this._getConfig('spellActivationTimes', 'id', spell.definition.activation.activationType).long+(spell.definition.activation.activationTime === 1 ? '' : 's')}
                }
            };

            // console.log(spellItem);
            items.push(spellItem);
        });

        actorEntity.update(obj, true);
        this.parseItems(actorEntity, items);
    }

    /**
     * Get character resistances, immunities, and vulnerabilities
     *
     * @param {Object} character - Character JSON data string parsed as an object after import
     */
    getDefemseAdjustments(character) {
        let conditionImmunities = [];
        let damageImmunities = [];
        this._getObjects(character.modifiers, 'type', 'immunity').forEach(da => {
            if (da.entityTypeId === 1737492944 || da.entityTypeId == null) conditionImmunities.push(da.subType);
            else damageImmunities.push(da.subType);
        });
        let resistances = this._getObjects(character.modifiers, 'type', 'resistance');
        let vulnerabilities = this._getObjects(character.modifiers, 'type', 'vulnerability');

        character.customDefenseAdjustments.forEach(cda => {
            if (cda.type === 2) {
                let conf = this._getConfig('customDamageDefenseAdjustments', 'id', cda.id);
                if (conf.type === 'immunity') {
                    damageImmunities.push(conf.subType);
                } else if (conf.type === 'resistance') {
                    resistances.push(conf.subType);
                } else if (conf.type === 'vulnerability') {
                    vulnerabilities.push(conf.subType);
                }
            } else if (cda.type === 1) {
                let conf = this._getConfig('customConditionDefenseAdjustments', 'id', cda.id);
                conditionImmunities.push(conf.subType);
            }
        });

        return {
            conditionImmunities: conditionImmunities.filter((value, index, self) => self.indexOf(value) === index),
            damageImmunities: damageImmunities.filter((value, index, self) => self.indexOf(value) === index),
            resistances: $.map(resistances, mod => mod.subType).filter((value, index, self) => self.indexOf(value) === index),
            vulnerabilities: $.map(vulnerabilities, mod => mod.subType).filter((value, index, self) => self.indexOf(value) === index)
        };
    }

    /**
     * Get character hit points
     *
     * @param {Object} character - Character JSON data string parsed as an object after import
     */
    getHp(character) {
        const totalLevel = character.classes.reduce((total, charClass) => total + charClass.level, 0);
        let hp = Math.floor(character.baseHitPoints + ( totalLevel * Math.floor( ( ( this.getTotalAbilityScore(character, 3) - 10 ) / 2 ) ) ) );

        // scan for modifiers except those in items, because we will get those bonuses from the items once they are imported
        // NOTE: this also handles the problem that Beyond includes modifiers from items that are not currently equipped/attuned
        let hpLevelBonus = this._getObjects(character.modifiers, 'subType', 'hit-points-per-level', ['item']).forEach((bonus) => {
            let level = totalLevel;

            // Ensure that per-level bonuses from class features only apply for the levels of the class and not the character's total level.
            let charClasses = character.classes.filter((charClass) => {
                let output = charClass.definition.classFeatures.findIndex(cF => cF.id == bonus.componentId) >= 0;
                if (charClass.subclassDefinition != null) {
                    output = output || charClass.subclassDefinition.classFeatures.findIndex(cF => cF.id == bonus.componentId) >= 0;
                }
                return output;
            });

            if (charClasses.length > 0) {
                level = 0;
                charClasses.forEach((charClass) => {
                    level += parseInt(charClass.level);
                });
            }

            hp += level * bonus.value;
        });

        return hp;
    }

    /**
     * Get character speeds (walking, swimming, flying, etc.)
     *
     * @param {Object} character - Character JSON data string parsed as an object after import
     */
    getSpeeds(character) {
        let weightSpeeds = character.race.weightSpeeds;
        if(weightSpeeds == null) {
            weightSpeeds = {
                "normal": {
                    "walk": 30,
                    "fly": 0,
                    "burrow": 0,
                    "swim": 0,
                    "climb": 0
                }
            };
        }

        let speedMods = this._getObjects(character.modifiers, 'subType', 'speed');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type == 'set') {
                    weightSpeeds.normal.walk = (speedMod.value > weightSpeeds.normal.walk ? speedMod.value : weightSpeeds.normal.walk);
                }
            });
        }

        speedMods = this._getObjects(character.modifiers, 'subType', 'innate-speed-flying');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type == 'set' && speedMod.id.indexOf('spell') == -1) {
                    if(speedMod.value == null) speedMod.value = weightSpeeds.normal.walk;
                    weightSpeeds.normal.fly = (speedMod.value > weightSpeeds.normal.fly ? speedMod.value : weightSpeeds.normal.fly);
                }
            });
        }

        speedMods = this._getObjects(character.modifiers, 'subType', 'innate-speed-swimming');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type == 'set' && speedMod.id.indexOf('spell') == -1) {
                    if(speedMod.value == null) speedMod.value = weightSpeeds.normal.walk;
                    weightSpeeds.normal.swim = (speedMod.value > weightSpeeds.normal.swim ? speedMod.value : weightSpeeds.normal.swim);
                }
            });
        }

        speedMods = this._getObjects(character.modifiers, 'subType', 'innate-speed-climbing');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type == 'set' && speedMod.id.indexOf('spell') == -1) {
                    if(speedMod.value == null) speedMod.value = weightSpeeds.normal.walk;
                    weightSpeeds.normal.climb = (speedMod.value > weightSpeeds.normal.climb ? speedMod.value : weightSpeeds.normal.climb);
                }
            });
        }

        speedMods = this._getObjects(character.modifiers, 'subType', 'unarmored-movement');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type == 'bonus') {
                    speedMod.value = isNaN(weightSpeeds.normal.walk + speedMod.value) ? 0 : speedMod.value;
                    weightSpeeds.normal.walk += speedMod.value;
                    if(weightSpeeds.normal.fly > 0) weightSpeeds.normal.fly += speedMod.value;
                    if(weightSpeeds.normal.swim > 0) weightSpeeds.normal.swim += speedMod.value;
                    if(weightSpeeds.normal.climb > 0) weightSpeeds.normal.climb += speedMod.value;
                }
            });
        }

        speedMods = this._getObjects(character.modifiers, 'subType', 'speed');
        if(speedMods != null) {
            speedMods.forEach((speedMod) => {
                if(speedMod.type == 'bonus') {
                    speedMod.value = isNaN(weightSpeeds.normal.walk + speedMod.value) ? 0 : speedMod.value;
                    weightSpeeds.normal.walk += speedMod.value;
                    if(weightSpeeds.normal.fly > 0) weightSpeeds.normal.fly += speedMod.value;
                    if(weightSpeeds.normal.swim > 0) weightSpeeds.normal.swim += speedMod.value;
                    if(weightSpeeds.normal.climb > 0) weightSpeeds.normal.climb += speedMod.value;
                }
            });
        }

        let speed = weightSpeeds.normal.walk + 'ft.';
        for(let key in weightSpeeds.normal){
            if(key !== 'walk' && weightSpeeds.normal[key] !== 0){
                speed += ', ' + key + ' ' + weightSpeeds.normal[key] + 'ft.';
            }
        }

        return speed;
    }

    /**
     * Get character senses
     *
     * @param {Object} character - Character JSON data string parsed as an object after import
     */
    getSenses(character) {
        let senses = [];
        this._getObjects(character.modifiers, 'type', 'sense').forEach((sense) => {
            if (senses.indexOf(sense.friendlySubtypeName) === -1) {
                let name = sense.friendlySubtypeName;
                if(sense.value != null) name += ' '+sense.value+' ft.'
                senses.push(name);
            }
        });
        return senses;
    }

    /**
     * Get character languages
     *
     * @param {Object} character - Character JSON data string parsed as an object after import
     */
    getLanguages(character) {
        let languages = this._getObjects(character, 'type', 'language');

        let langs = [];
        if(languages != null) {
            languages.forEach((language) => {
                langs.push(language.friendlySubtypeName);
            });
        }

        return langs;
    }

    /**
     * Get character features
     *
     * @param {Object} character - The character data
     */
    getFeatures(character) {
        let biography = '';
        let classSpells = [];

        // Background Feature
        if(character.background.definition != null) {
            let btrait = {
                name: character.background.definition.featureName,
                description: character.background.definition.featureDescription,
                source: 'Background',
                source_type: character.background.definition.name
            }

            biography += '<h3><strong>'+btrait.name+'</strong></h3><p><small><em>'+btrait.source+': '+btrait.source_type+'</em></small></p><p>'+btrait.description+'</p>';
        }

        // Custom Background Feature
        if(character.background.customBackground != null) {
            if(character.background.customBackground.featuresBackground != null) {
                let btrait = {
                    name: character.background.customBackground.featuresBackground.featureName,
                    description: character.background.customBackground.featuresBackground.featureDescription,
                    source: 'Background',
                    source_type: character.background.customBackground.name
                };

                biography += '<h3><strong>'+btrait.name+'</strong></h3><p><small><em>'+btrait.source+': '+btrait.source_type+'</em></small></p><p>'+btrait.description+'</p>';
            }
        }

        // Feats
        character.feats.forEach((feat, fi) => {
            let btrait = {
                name: feat.definition.name,
                description: feat.definition.description,
                source: 'Feat',
                source_type: feat.definition.name
            };

            biography += '<h3><strong>'+btrait.name+'</strong></h3><p><small><em>'+btrait.source+': '+btrait.source_type+'</em></small></p><p>'+btrait.description+'</p>';
        });

        // Race Features
        if(character.race.racialTraits != null) {
            let ti = 0;
            character.race.racialTraits.forEach((trait) => {
                if(['Languages', 'Darkvision', 'Superior Darkvision', 'Skills', 'Ability Score Increase', 'Feat', 'Age', 'Alignment', 'Size', 'Speed', 'Skill Versatility', 'Dwarven Combat Training', 'Keen Senses', 'Elf Weapon Training', 'Extra Language', 'Tool Proficiency'].indexOf(trait.definition.name) !== -1) {
                    return;
                }

                let description = '';
                if(trait.options != null) {
                    trait.options.forEach((option) => {
                        description += option.name + '\n';
                        description += (option.description !== '') ? option.description + '\n\n' : '\n';
                    });
                }

                description += trait.definition.description;

                let btrait = {
                    name: trait.definition.name,
                    description: description,
                    source: 'Race',
                    source_type: character.race.fullName
                };

                biography += '<h3><strong>'+btrait.name+'</strong></h3><p><small><em>'+btrait.source+': '+btrait.source_type+'</em></small></p><p>'+btrait.description+'</p>';

                let spells = this.getFeatureSpells(character, trait.id, 'race');
                spells.forEach((spell) => {
                    spell.spellCastingAbility = this._getConfig('abilities', 'id', spell.spellCastingAbilityId).short;
                    classSpells.push(spell);
                });

                ti++;
            });
        }

        // Handle (Multi)Class Features
        let multiClassLevel = 0;
        let multiClasses = [];
        let totalLevel = 0;
        let monkLevel = 0;
        let jackOfAllTrades = false;
        let criticalRange = 20;
        character.classes.forEach((currentClass, i) => {
            totalLevel += currentClass.level;

            if(!currentClass.isStartingClass){
                multiClasses.push({
                    name: currentClass.definition.name,
                    level: currentClass.level,
                    subclass: currentClass.subclassDefinition == null ? '' : currentClass.subclassDefinition.name
                });
                multiClassLevel += currentClass.level;
            }

            // Set Pact Magic as class resource
            if(currentClass.definition.name.toLowerCase() === 'warlock') {
                // let attributes = {}
                // attributes['other_resource_name'] = 'Pact Magic';
                // attributes['other_resource_max'] = getPactMagicSlots(currentClass.level);
                // attributes['other_resource'] = getPactMagicSlots(currentClass.level);
                // Object.assign(single_attributes, attributes);
            }

            if(currentClass.definition.name === 'Monk') monkLevel = currentClass.level;

            if(currentClass.definition.name.toLowerCase() === 'fighter' && currentClass.subclassDefinition != null) {
                if(currentClass.subclassDefinition.name.toLowerCase() === 'champion') {
                    currentClass.subclassDefinition.classFeatures.forEach((feature, i) => {
                        if(feature.id === 215 && currentClass.level >= feature.requiredLevel) { // improved critical
                            criticalRange = Math.min(19, criticalRange);
                        }
                        if(feature.id === 218 && currentClass.level >= feature.requiredLevel) {
                            criticalRange = Math.min(18, criticalRange);
                        }
                    });
                }
            }

            let ti = 0;
            currentClass.definition.classFeatures.forEach((trait) => {
                if(['Spellcasting', 'Divine Domain', 'Ability Score Improvement', 'Bonus Cantrip', 'Proficiencies', 'Hit Points', 'Arcane Tradition', 'Otherworldly Patron', 'Pact Magic', 'Expanded Spell List', 'Ranger Archetype', 'Druidic', 'Druid Circle', 'Sorcerous Origin', 'Monastic Tradition', 'Bardic College', 'Expertise', 'Roguish Archetype', 'Sacred Oath', 'Oath Spells', 'Martial Archetype'].indexOf(trait.name) !== -1) {
                    return;
                }
                if(trait.requiredLevel > currentClass.level) return;

                if(trait.name.includes('Jack')){
                    jackOfAllTrades = true;
                }

                let description = '';

                description += trait.description;

                let btrait = {
                    name: trait.name,
                    description: description,
                    source: 'Class',
                    source_type: currentClass.definition.name
                };

                biography += '<h3><strong>'+btrait.name+'</strong></h3><p><small><em>'+btrait.source+': '+btrait.source_type+'</em></small></p><p>'+btrait.description+'</p>';

                let spells = this.getFeatureSpells(character, trait.id, 'class');
                spells.forEach((spell) => {
                    if(spell.spellCastingAbilityId == null) {
                        if(currentClass.subclassDefinition != null) {
                            spell.spellCastingAbilityId = currentClass.subclassDefinition.spellCastingAbilityId;
                        } else {
                            spell.spellCastingAbilityId = currentClass.definition.spellCastingAbilityId;
                        }
                    }
                    spell.spellCastingAbility = this._getConfig('abilities', 'id', spell.spellCastingAbilityId);
                    classSpells.push(spell);
                });

                if(trait.name === 'Metamagic') {
                    character.choices.class.forEach((option) => {
                        if(option.type === 3 && (option.optionValue >= 106 && option.optionValue <= 113)) {
                            let item = this._getObjects(option.options, 'id', option.optionValue);

                            if(item.length > 0) {
                                item = item[0];
                                let btrait = {
                                    name: item.label,
                                    description: item.description,
                                    source: 'Class',
                                    source_type: currentClass.definition.name
                                };

                                biography += '<h3><strong>'+btrait.name+'</strong></h3><p><small><em>'+btrait.source+': '+btrait.source_type+'</em></small></p><p>'+btrait.description+'</p>';
                            }
                        }
                    });
                }

                ti++;
            });

            if(currentClass.subclassDefinition != null) {
                let ti = 0;
                currentClass.subclassDefinition.classFeatures.forEach((trait) => {
                    if(['Spellcasting', 'Bonus Proficiency', 'Divine Domain', 'Ability Score Improvement', 'Bonus Cantrip', 'Proficiencies', 'Hit Points', 'Arcane Tradition', 'Otherworldly Patron', 'Pact Magic', 'Expanded Spell List', 'Ranger Archetype', 'Druidic', 'Druid Circle', 'Sorcerous Origin', 'Monastic Tradition', 'Bardic College', 'Expertise', 'Roguish Archetype', 'Sacred Oath', 'Oath Spells', 'Martial Archetype'].indexOf(trait.name) !== -1) {
                        return;
                    }
                    if(trait.requiredLevel > currentClass.level) return;

                    if(trait.name.includes('Jack')){
                        jackOfAllTrades = true;
                    }

                    let description = '';

                    description += trait.description;

                    let btrait = {
                        name: trait.name,
                        description: description,
                        source: 'Class',
                        source_type: currentClass.definition.name
                    };

                    biography += '<h3><strong>'+btrait.name+'</strong></h3><p><small><em>'+btrait.source+': '+btrait.source_type+'</em></small></p><p>'+btrait.description+'</p>';

                    let spells = this.getFeatureSpells(character, trait.id, 'class');
                    spells.forEach((spell) => {
                        spell.spellCastingAbility = this._getConfig('abilities', 'id', spell.spellCastingAbilityId);
                        classSpells.push(spell);
                    });

                    ti++;
                });
            }

            // Class Spells
            for(let i in character.classSpells) {
                const charClass = character.classes.find(cc => cc.id === character.classSpells[i].characterClassId);
                if(character.classSpells[i].characterClassId === currentClass.id) {
                    character.classSpells[i].spells.forEach((spell) => {
                        if(spell.spellCastingAbilityId == null && charClass != null) {
                            if(charClass.subclassDefinition != null) {
                                spell.spellCastingAbilityId = charClass.subclassDefinition.spellCastingAbilityId;
                            } else {
                                spell.spellCastingAbilityId = charClass.definition.spellCastingAbilityId;
                            }
                        }
                        spell.spellCastingAbility = this._getConfig('abilities', 'id', spell.spellCastingAbilityId);
                        classSpells.push(spell);
                    });
                }
            }
        });

        return {
            biography: biography,
            spells: classSpells,
            jackOfAllTrades: jackOfAllTrades,
            multiClassLevel: multiClassLevel,
            multiClasses: multiClasses,
            level: totalLevel,
            monkLevel: monkLevel
        };
    }

    /**
     * Get character inventory and armor class
     *
     * @param {Object} character - The character data
     * @param {Number} traitId - Character trait id from D&D Beyond
     * @param {String} featureType - The type of feature being searched
     */
    getFeatureSpells(character, traitId, featureType) {
        let spellsArr = [];
        if(character.spells[featureType] == null) return spellsArr;
        if(character.spells[featureType].length > 0) {
            let options = this._getObjects(character.options[featureType], 'componentId', traitId);
            for(let i = 0; i < options.length; i++) {
                let spells = this._getObjects(character.spells[featureType], 'componentId', options[i].definition.id);
                for(let j = 0; j < spells.length; j++) {
                    spellsArr.push(spells[j])
                }
            }
        }
        return spellsArr;
    }

    /**
     * Get character inventory and armor class
     *
     * @param {Object} character - The character data
     * @param {Object} actorEntity - The Actor5e entity
     */
    getInventory(character, actorEntity, features) {
        // accumulate unique fighting styles selected
        const fightingStyles = new Set();
        this._getObjects(character.classes, 'name', 'Fighting Style').forEach((fS) => {
            this._getObjects(character.choices, 'componentId', fS.id).forEach((fsOpt) => {
                if(fsOpt.optionValue != null) {
                    this._getObjects(fsOpt.options, 'id', fsOpt.optionValue).forEach((selOpt) => {
                        fightingStyles.add(selOpt.label);
                    });
                }
            });
        });

        let ac = 0;
        let dexMod = 0;
        let weaponCritRange = 20;
        let criticalRange = 20;
        let items = [];
        let hasArmor = false;
        let shieldEquipped = false;

        const inventory = character.inventory;
        if(inventory != null) {
            inventory.forEach((item, i) => {
                if (item.definition.type === 'Shield' && item.equipped) shieldEquipped = true;
                if (["Light Armor", "Medium Armor", "Heavy Armor"].indexOf(item.definition.type) >= 0 && item.equipped) hasArmor = true;
            });
            inventory.forEach((item, i) => {
                const isWeapon = typeof item.definition.damage === 'object' && item.definition.type !== 'Ammunition';
                if (typeof item.definition.damage === 'object' && item.definition.type !== 'Ammunition') {
                    let sheetItem = {
                        img: "icons/mystery-man.png",
                        name: "New Weapon",
                        type: "weapon",
                        data: {
                            ability: {type: "String", label: "Offensive Ability"},
                            attuned: {type: "Boolean", label: "Attuned"},
                            bonus: {type: "String", label: "Weapon Bonus"},
                            damage: {type: "String", label: "Damage Formula"},
                            damageType: {type: "String", label: "Damage Type"},
                            damage2: {type: "String", label: "Alternate Damage"},
                            damage2Type: {type: "String", label: "Alternate Type"},
                            description: {type: "String", label: "Description"},
                            price: {type: "String", label: "Price"},
                            proficient: {type: "Boolean", label: "Proficient"},
                            properties: {type: "String", label: "Weapon Properties"},
                            quantity: {type: "Number", label: "Quantity", value: 1},
                            range: {type: "String", label: "Weapon Range"},
                            source: {type: "String", label: "Source", value: item.id.toString()},
                            weaponType: {type: "String", label: "Weapon Type"},
                            weight: {type: "Number", label: "Weight"}
                        }
                    };

                    let properties = '';
                    let finesse = false;
                    let twohanded = false;
                    let ranged = false;
                    let hasOffhand = false;
                    let isOffhand = false;
                    let versatile = false;
                    let versatileDice = '';
                    item.definition.properties.forEach((prop) => {
                        if (prop.name === 'Two-Handed') {
                            twohanded = true;
                        }
                        if (prop.name === 'Range') {
                            ranged = true;
                        }
                        if (prop.name === 'Finesse') {
                            finesse = true;
                        }
                        if (prop.name === 'Versatile') {
                            versatile = true;
                            versatileDice = prop.notes;
                        }

                        properties += prop.name + ', ';
                    });

                    let cv = this._getObjects(character.characterValues, 'valueTypeId', item.entityTypeId);
                    cv.forEach((v) => {
                        if (v.typeId === 18 && v.value === true) {
                            hasOffhand = true;
                            if (v.valueId === item.id) {
                                isOffhand = true;
                            }
                        }
                    });

                    let magic = 0;
                    item.definition.grantedModifiers.forEach((grantedMod) => {
                        if (grantedMod.type === 'bonus' && grantedMod.subType === 'magic') {
                            magic += grantedMod.value;
                        }
                    });

                    // Finesse Weapon
                    let isFinesse = item.definition.properties.filter((property) => {
                        return property.name === 'Finesse';
                    }).length > 0;
                    if (isFinesse && this.getTotalAbilityScore(character, 2) > this.getTotalAbilityScore(character, item.definition.attackType)) {
                        item.definition.attackType = 2;
                    }

                    // Hexblade's Weapon
                    let characterValues = this._getObjects(character.characterValues, 'valueId', item.id);
                    characterValues.forEach((cv) => {
                        if (cv.typeId === 29 && this.getTotalAbilityScore(character, 6) >= this.getTotalAbilityScore(character, item.definition.attackType)) {
                            item.definition.attackType = 6;
                        }
                    });

                    let gwf = false;
                    let atkmod = 0;
                    let dmgmod = 0;
                    let hasTWFS = false;

                    // process each fighting style only once
                    fightingStyles.forEach((fightingStyle) => {
                        if (fightingStyle === 'Great Weapon Fighting' && twohanded) {
                            gwf = true;
                        }
                        if (fightingStyle === 'Archery' && ranged) {
                            atkmod += 2;
                        }
                        if (fightingStyle === 'Dueling' && !(hasOffhand || ranged || twohanded)) {
                            dmgmod += 2;
                        }
                        if (fightingStyle === 'Two-Weapon Fighting') {
                            hasTWFS = true;
                        }
                    });

                    if (versatile && !(hasOffhand || shieldEquipped)) {
                        item.definition.damage.diceString = versatileDice;
                    }

                    if (item.definition.isMonkWeapon && features.monkLevel > 0) {
                        let itemAvgDmg = 0;
                        if (item.definition.damage != null) {
                            let dS = item.definition.damage.diceString;
                            let itemDieCount = parseInt(dS.substr(0, dS.indexOf('d')));
                            let itemDieSize = parseInt(dS.substr(dS.indexOf('d') + 1));
                            itemAvgDmg = (itemDieCount * (itemDieSize + 1)) / 2;
                        }

                        let monkDieSize = Math.floor((features.monkLevel - 1) / 4) * 2 + 4;
                        let monkAvgDmg = (1 + monkDieSize) / 2;

                        if (monkAvgDmg > itemAvgDmg) {
                            item.definition.damage.diceString = '1d' + monkDieSize;
                        }

                        let str = this.getTotalAbilityScore(character, 1);
                        let dex = this.getTotalAbilityScore(character, 2);
                        if (dex > str) {
                            item.definition.attackType = 2;
                        }
                    }

                    if (!hasTWFS && isOffhand) {
                        dmgmod -= Math.floor((this.getTotalAbilityScore(character, item.definition.attackType) - 10) / 2);
                    }

                    sheetItem.name = item.definition.name;
                    sheetItem.data.range.value = item.definition.range + (item.definition.range != item.definition.longRange ? '/' + item.definition.longRange : '') + 'ft.';
                    sheetItem.data.weight.value = item.definition.weight;
                    sheetItem.data.ability.value = this._getConfig('abilities', 'id', item.definition.attackType).short;
                    sheetItem.data.bonus.value = magic;
                    sheetItem.data.description.value = item.definition.description;
                    sheetItem.data.properties.value = 'Crit: ' + Math.min(weaponCritRange, criticalRange);
                    sheetItem.data.damage.value = item.definition.damage != null ? item.definition.damage.diceString + (gwf ? 'ro<2' : '') + (dmgmod >= 0 ? '+' + dmgmod : '-' + Math.abs(dmgmod)) : '';
                    sheetItem.data.damageType.value = item.definition.damageType;

                    item.definition.grantedModifiers.forEach((grantedMod) => {
                        if (grantedMod.type === 'damage') {
                            if (grantedMod.dice != null) {
                                sheetItem.data.damage2.value = grantedMod.dice.diceString + (grantedMod.statId == null ? '' : '+' + Math.floor((this.getTotalAbilityScore(character, grantedMod.statId) - 10) / 2));
                                sheetItem.data.damage2Type.value = grantedMod.friendlySubtypeName;
                            }
                        }
                    });

                    items.push(sheetItem);
                }

                const isArmor = item.definition.hasOwnProperty('armorClass') || item.definition.grantedModifiers.filter(mod => mod.subType === 'unarmored-armor-class').length > 0;
                if (isArmor) {
                    let sheetItem = {
                        img: "icons/mystery-man.png",
                        name: "New Equipment",
                        type: "equipment",
                        data: {
                            armor: {type: "Number", label: "Armor Value"},
                            armorType: {type: "String", label: "Armor Type"},
                            attuned: {type: "Boolean", label: "Attuned"},
                            description: {type: "String", label: "Description"},
                            equipped: {type: "Boolean", label: "Equipped"},
                            price: {type: "String", label: "Price"},
                            proficient: {type: "Boolean", label: "Proficient"},
                            quantity: {type: "Number", label: "Quantity", value: 1},
                            source: {type: "String", label: "Source", value: item.id.toString()},
                            stealth: {type: "Boolean", label: "Stealth Disadvantage"},
                            strength: {type: "String", label: "Required Strength"},
                            weight: {type: "Number", label: "Weight"}
                        }
                    };


                    sheetItem.name = item.definition.name;
                    sheetItem.data.armor.value = parseInt(item.definition.armorClass == null ? 0 : item.definition.armorClass);
                    sheetItem.data.armorType.value = 'bonus';
                    sheetItem.data.equipped.value = item.equipped;
                    sheetItem.data.attuned.value = item.isAttuned;
                    sheetItem.data.weight.value = item.definition.weight;
                    sheetItem.data.strength.value = (item.definition.strengthRequirement == null ? 0 : item.definition.strengthRequirement).toString();
                    sheetItem.data.description.value = item.definition.description;
                    sheetItem.data.stealth.value = item.definition.stealthCheck === 2;
                    item.definition.grantedModifiers.forEach((grantedMod) => {
                        if (grantedMod.type === 'set') {
                            switch (grantedMod.subType) {
                                case 'unarmored-armor-class':
                                    sheetItem.data.equipped.value = false;
                                    if (!hasArmor) {
                                        sheetItem.data.armor.value = parseInt(grantedMod.value);
                                        sheetItem.data.equipped.value = true;
                                    }
                                    break;
                            }
                        }
                        if (grantedMod.type === 'bonus') {
                            switch (grantedMod.subType) {
                                case 'unarmored-armor-class':
                                    sheetItem.data.equipped.value = false;
                                    if (!hasArmor) {
                                        sheetItem.data.armor.value += parseInt(grantedMod.value);
                                        sheetItem.data.equipped.value = true;
                                    }
                                    break;
                            }
                        }
                    });
                    if (["Light Armor", "Medium Armor", "Heavy Armor"].indexOf(item.definition.type) >= 0) {
                        // This includes features such as defense fighting style, which require the user to wear armor
                        let aac = this._getObjects(character, 'subType', 'armored-armor-class');
                        aac.forEach((aacb) => {
                            sheetItem.data.armor.value += parseInt(aacb.value);
                        });
                    }
                    if (["Light Armor", "Medium Armor", "Heavy Armor", "Shield"].indexOf(item.definition.type) >= 0) {
                        sheetItem.data.armorType.value = this._getConfig('equipmentTypes', 'long', item.definition.type).short;
                    }

                    if (item.definition.type === 'Light Armor' && item.equipped && dexMod === 0) {
                        dexMod = this.getAbilityMod(this.getTotalAbilityScore(character, 2));
                    }

                    if (item.definition.type === 'Medium Armor' && item.equipped && dexMod === 0) {
                        dexMod = this.getAbilityMod(this.getTotalAbilityScore(character, 2));
                    }

                    if (sheetItem.data.equipped.value) {
                        ac += sheetItem.data.armor.value;
                    }

                    items.push(sheetItem);
                }

                const isConsumable = item.definition.isConsumable || ['Wand', 'Scroll'].indexOf(item.definition.subType) >= 0 || item.definition.tags.find(tag => tag === 'Consumable');
                if (isConsumable) {
                    let dice = item.definition.description.match(/\d+d\d+ ?\+? ?(\d+)+/g);
                    let type = '';
                    switch (item.definition.subType) {
                        case 'Potion':
                            type = 'potion';
                            break;
                        case 'Wand':
                            type = 'wand';
                            break;
                        case 'Scroll':
                            type = 'scroll';
                            break;
                    }
                    let sheetItem = {
                        img: "icons/mystery-man.png",
                        name: item.definition.name,
                        type: "consumable",
                        data: {
                            autoDestroy: {type: "Boolean", label: "Destroy on Empty", value: true},
                            autoUse: {type: "Boolean", label: "Consume on Use", value: true},
                            charges: {type: "Number", label: "Charges", value: 1, max: 1},
                            consumableType: {type: "String", label: "Consumable Type", value: type},
                            consume: {type: "String", label: "Roll on Consume", value: dice ? dice[0] : ''},
                            description: {type: "String", label: "Description", value: item.definition.description},
                            price: {type: "String", label: "Price", value: item.definition.cost},
                            quantity: {type: "Number", label: "Quantity", value: item.quantity},
                            source: {type: "String", label: "Source", value: item.id.toString()},
                            weight: {type: "Number", label: "Weight", value: item.definition.weight}
                        }
                    };

                    if (item.limitedUse != null) {
                        sheetItem.data.charges.value = item.limitedUse.maxUses - item.limitedUse.numberUsed;
                        sheetItem.data.charges.max = item.limitedUse.maxUses;
                    }

                    items.push(sheetItem);
                }

                const isTool = item.definition.subType === 'Tool';
                if (isTool) {
                    character.customProficiencies.filter(prof => prof.name === item.definition.name && prof.statId != null).forEach(prof => {
                        let sheetItem = {
                            img: 'icons/mystery-man.png',
                            name: this._getConfig('abilities', 'id', prof.statId).long + ' (' +item.definition.name + ')',
                            type: 'tool',
                            data: {
                                ability: {type: "String", label: "Default Ability", value: this._getConfig('abilities', 'id', prof.statId).short},
                                description: {type: "String", label: "Description", value: item.definition.description},
                                price: {type: "String", label: "Price", value: item.definition.cost},
                                proficient: {type: "Boolean", label: "Proficient", value: !(prof.proficiencyLevel === 0)},
                                quantity: {type: "Number", label: "Quantity", value: 1},
                                source: {type: "String", label: "Source", value: item.id.toString()},
                                weight: {type: "Number", label: "Weight", value: item.definition.weight}
                            }
                        };

                        items.push(sheetItem);
                    });
                }

                if (!isWeapon && !isArmor && !isConsumable && !isTool) {
                    let sheetItem = {
                        img: "icons/mystery-man.png",
                        name: item.definition.name,
                        type: "backpack",
                        data: {
                            description: {type: "String", label: "Description", value: item.definition.description},
                            price: {type: "String", label: "Price", value: item.definition.cost},
                            quantity: {type: "Number", label: "Quantity", value: item.quantity},
                            source: {type: "String", label: "Source", value: item.id},
                            weight: {type: "Number", label: "Weight", value: item.definition.weight}
                        }
                    };

                    items.push(sheetItem);
                }
            });
        }

        // Check for unarmored defense
        const unarmored = this._getObjects(character.modifiers, 'subType', 'unarmored-armor-class');
        if (unarmored != null) { // Warforged Integrated Protection
            unarmored.filter(ua => ua.componentTypeId == 306912077).forEach((ua, i) => {
                let sheetItem = {
                    img: "icons/mystery-man.png",
                    name: "Integrated Protection",
                    type: "equipment",
                    data: {
                        armor: {type: "Number", label: "Armor Value"},
                        armorType: {type: "String", label: "Armor Type", value: "natural"},
                        attuned: {type: "Boolean", label: "Attuned", value: false},
                        description: {type: "String", label: "Description", value: ""},
                        equipped: {type: "Boolean", label: "Equipped", value: true},
                        price: {type: "String", label: "Price", value: 0},
                        proficient: {type: "Boolean", label: "Proficient", value: true},
                        quantity: {type: "Number", label: "Quantity", value: 1},
                        source: {type: "String", label: "Source", value: ua.id.toString()},
                        stealth: {type: "Boolean", label: "Stealth Disadvantage"},
                        strength: {type: "String", label: "Required Strength", value: 0},
                        weight: {type: "Number", label: "Weight", value: 0}
                    }
                };

                if(ua.value == 6) {
                    sheetItem.data.armorType.value = 'heavy';
                    sheetItem.data.stealth.value = true;
                    ua.value = 10 + parseInt(ua.value);
                }
                else if(ua.value == 3) {
                    sheetItem.data.armorType.value = 'medium';
                    ua.value = 10 + parseInt(ua.value);
                }
                ua.value += Math.floor((character.classes.reduce((total, c) => total + c.level, 0) + 7) / 4);

                sheetItem.data.armor.value = ua.value;

                let aac = this._getObjects(character, 'subType', 'armored-armor-class');
                aac.forEach((aacb) => {
                    sheetItem.data.armor.value += parseInt(aacb.value);
                });

                ac += sheetItem.data.armor.value;

                hasArmor = true;

                items.push(sheetItem);
            });
        }

        if (unarmored != null && !hasArmor) {
            dexMod = this.getAbilityMod(this.getTotalAbilityScore(character, 2));
            ac += 10;
            unarmored.forEach((ua, i) => {
                if(ua.type != 'set') return;
                if(ua.value == null) {
                    ua.value = Math.floor((this.getTotalAbilityScore(character, ua.statId) - 10) / 2);
                }

                ac += ua.value;
            });
        }

        ac += dexMod;

        return {
            ac: ac,
            items: items,
            hasArmor: hasArmor,
            hasShield: shieldEquipped
        };
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
     * Get total ability score including modifiers
     *
     * @param {Object} character - Character JSON data string parsed as an object after import
     * @param {Number} scoreId - 1 = STR, 2 = DEX, 3 = CON, 4 = INT, 5 = WIS, 6 = DEX
     */
    getTotalAbilityScore(character, scoreId) {
        let index = scoreId-1;
        let base = (character.stats[index].value == null ? 10 : character.stats[index].value),
            bonus = (character.bonusStats[index].value == null ? 0 : character.bonusStats[index].value),
            override = (character.overrideStats[index].value == null ? 0 : character.overrideStats[index].value),
            total = base + bonus,
            modifiers = this._getObjects(character, '', this._getConfig('abilities', 'id', scoreId).long.toLowerCase() + "-score");
        if (override > 0) total = override;
        let usedIds = [];
        modifiers.forEach((mod) => {
            if (mod.type === 'bonus' && usedIds.indexOf(mod.id) === -1) {
                total += mod.value;
                usedIds.push(mod.id);
            }
        });

        return total;
    }

    getAbilityMod(score) {
        return Math.floor((score - 10) / 2);
    }

    /**
     * Return an array of objects according to key, value, or key and value matching,
     * optionally ignoring objects in array of names
     *
     * @param {Object} obj - An object to iterate through searching for objects containing a key/value pair
     * @param {String} key - An object parameter key to search by
     * @param {Any} val - A value to search for
     * @param {String[]} except - An array of keys to ignore
     */
    _getObjects(obj, key, val, except = []) {
        let objects = [];
        for (let i in obj) {
            if (!obj.hasOwnProperty(i)) continue;
            if (typeof obj[i] == 'object') {
                if (except.indexOf(i) != -1) {
                    continue;
                }
                objects = objects.concat(this._getObjects(obj[i], key, val));
            } else
            //if key matches and value matches or if key matches and value is not passed (eliminating the case where key matches but passed value does not)
            if (i == key && obj[i] == val || i == key && val == '') { //
                objects.push(obj);
            } else if (obj[i] == val && key == ''){
                //only add if the object is not already in the array
                if (objects.lastIndexOf(obj) == -1){
                    objects.push(obj);
                }
            }
        }
        return objects;
    }

    _getConfig(type, key, value) {
        return CONFIG.BeyondImporter[type].find((item) => {
            return item[key] == value;
        });
    }
}

CONFIG.BeyondImporter = {
    abilities: [
        { id: 1, short: 'str', long: 'Strength' },
        { id: 2, short: 'dex', long: 'Dexterity' },
        { id: 3, short: 'con', long: 'Constitution' },
        { id: 4, short: 'int', long: 'Intelligence' },
        { id: 5, short: 'wis', long: 'Wisdom' },
        { id: 6, short: 'cha', long: 'Charisma' }
    ],
    alignments: [
        { id: 1, short: 'LG', long: 'Lawful Good' },
        { id: 2, short: 'NG', long: 'Neutral Good' },
        { id: 3, short: 'CG', long: 'Chaotic Good' },
        { id: 4, short: 'LN', long: 'Lawful Neutral' },
        { id: 5, short: 'N', long: 'Neutral' },
        { id: 6, short: 'CN', long: 'Chaotic Neutral' },
        { id: 7, short: 'LE', long: 'Lawful Evil' },
        { id: 8, short: 'NE', long: 'Neutral Evil' },
        { id: 9, short: 'CE', long: 'Chaotic Evil' }
    ],
    equipmentTypes: [
        { short: 'light', long: 'Light Armor' },
        { short: 'medium', long: 'Medium Armor' },
        { short: 'heavy', long: 'Heavy Armor' },
        { short: 'shield', long: 'Shield' }
    ],
    spellComponents: [
        { id: 1, short: 'V', long: 'Verbal' },
        { id: 2, short: 'S', long: 'Somatic' },
        { id: 3, short: 'M', long: 'Material' }
    ],
    spellActivationTimes: [
        { id: 0, short: '', long: 'No Action' },
        { id: 1, short: 'A', long: 'Action' },
        { id: 3, short: 'BA', long: 'Bonus Action' },
        { id: 4, short: 'R', long: 'Reaction' },
        { id: 6, short: 'Min', long: 'Minute' },
        { id: 7, short: 'Hour', long: 'Hour' },
    ],
    customDamageDefenseAdjustments: [
        { id: 1, type: 'resistance', subType: 'Bludgeonining' },
        { id: 2, type: 'resistance', subType: 'Piercing' },
        { id: 3, type: 'resistance', subType: 'Slashing' },
        { id: 4, type: 'resistance', subType: 'Lightning' },
        { id: 5, type: 'resistance', subType: 'Thunder' },
        { id: 6, type: 'resistance', subType: 'Poison' },
        { id: 7, type: 'resistance', subType: 'Cold' },
        { id: 8, type: 'resistance', subType: 'Radiant' },
        { id: 9, type: 'resistance', subType: 'Fire' },
        { id: 10, type: 'resistance', subType: 'Necrotic' },
        { id: 11, type: 'resistance', subType: 'Acid' },
        { id: 12, type: 'resistance', subType: 'Psychic' },
        { id: 47, type: 'resistance', subType: 'Force' },
        { id: 51, type: 'resistance', subType: 'Ranged attacks' },
        { id: 52, type: 'resistance', subType: 'Damage dealt by traps' },
        { id: 54, type: 'resistance', subType: 'Bludgeoning from non magical attacks' },
        { id: 17, type: 'immunity', subType: 'Bludgeonining' },
        { id: 18, type: 'immunity', subType: 'Piercing' },
        { id: 19, type: 'immunity', subType: 'Slashing' },
        { id: 20, type: 'immunity', subType: 'Lightning' },
        { id: 21, type: 'immunity', subType: 'Thunder' },
        { id: 22, type: 'immunity', subType: 'Poison' },
        { id: 23, type: 'immunity', subType: 'Cold' },
        { id: 24, type: 'immunity', subType: 'Radiant' },
        { id: 25, type: 'immunity', subType: 'Fire' },
        { id: 26, type: 'immunity', subType: 'Necrotic' },
        { id: 27, type: 'immunity', subType: 'Acid' },
        { id: 28, type: 'immunity', subType: 'Psychic' },
        { id: 48, type: 'immunity', subType: 'Force' },
        { id: 33, type: 'vulnerability', subType: 'Bludgeonining' },
        { id: 34, type: 'vulnerability', subType: 'Piercing' },
        { id: 35, type: 'vulnerability', subType: 'Slashing' },
        { id: 36, type: 'vulnerability', subType: 'Lightning' },
        { id: 37, type: 'vulnerability', subType: 'Thunder' },
        { id: 38, type: 'vulnerability', subType: 'Poison' },
        { id: 39, type: 'vulnerability', subType: 'Cold' },
        { id: 40, type: 'vulnerability', subType: 'Radiant' },
        { id: 41, type: 'vulnerability', subType: 'Fire' },
        { id: 42, type: 'vulnerability', subType: 'Necrotic' },
        { id: 43, type: 'vulnerability', subType: 'Acid' },
        { id: 44, type: 'vulnerability', subType: 'Psychic' },
        { id: 49, type: 'vulnerability', subType: 'Force' }
    ],
    customConditionDefenseAdjustments: [
        { id: 1, subType: 'Blinded' },
        { id: 2, subType: 'Charmed"' },
        { id: 3, subType: 'Deafened' },
        { id: 4, subType: 'Exhaustion"' },
        { id: 5, subType: 'Frightened' },
        { id: 6, subType: 'Grappled"' },
        { id: 7, subType: 'Incapacitated' },
        { id: 8, subType: 'Invisible"' },
        { id: 9, subType: 'Paralyzed' },
        { id: 10, subType: 'Petrified"' },
        { id: 11, subType: 'Poisoned' },
        { id: 12, subType: 'Prone"' },
        { id: 13, subType: 'Restrained' },
        { id: 14, subType: 'Stunned"' },
        { id: 15, subType: 'Unconscious' }
    ]
};

let ddbi = new BeyondImporter();
ddbi.render();