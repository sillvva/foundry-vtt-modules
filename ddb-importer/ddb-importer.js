/**
 * @author Matt DeKok <Sillvva>
 * @version 0.1
 */

class BeyondImporter extends Application {

    constructor(app) {
        super(app);

        this.hookActorSheet();
        this.hookActorList();
    }

    /**
     * Hook into the render call for the Actor5eSheet to add an extra button
     */
    hookActorSheet() {
        Hooks.on('renderActor5eSheet', (app, html, data) => {
            // console.log(app, data);
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
            console.log(game);
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

        console.log(options.actor);

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
                this.parseCharacterData(actor, data);
            });
        } else {
            this.parseCharacterData(opts.actor, data);
        }
    }

    /**
     * Parse character data into the actor sheet
     *
     * @param {String} actorEntity - The Actor5e entity that will be updated with the new data
     * @param {Object} data - Character JSON data string parsed as an object after import
     */
    parseCharacterData(actorEntity, data) {
        console.log(data);
        let actor = Object.assign({}, actorEntity.data);
        let character = data.character;
        delete actor._id;

        let items = [];

        let features = this.getFeatures(character);
        let classSpells = features.spells;
        let biography = features.biography;

        actor.img = character.avatarUrl;
        actor.name = character.name;

        // Set Details
        actor.data.details.level.value = features.level;
        actor.data.details.race.value = character.race.fullName;
        actor.data.details.alignment.value = this._getConfig('alignments', 'id', character.alignmentId).long;
        actor.data.details.background.value = character.background.definition != null ? character.background.definition.name : (character.background.customBackground != null ? character.background.customBackground.name : '');
        actor.data.details.xp.value = character.currentXp.toString();

        // Set Attributes
        actor.data.attributes.prof.value = Math.floor((features.level + 7) / 4);
        actor.data.attributes.hd.value = features.level;
        actor.data.attributes.hp.value = this.getHp(character).toString();
        actor.data.attributes.hp.max = this.getHp(character).toString();
        actor.data.attributes.spellcasting.value = '';
        actor.data.attributes.speed.value = this.getSpeeds(character);

        let inv = this.getInventory(character, actorEntity, features);
        items = items.concat(inv.items);
        actor.data.attributes.ac.value = inv.ac;

        // Set Traits
        let senses = [];
        this._getObjects(character.modifiers, 'type', 'sense').forEach((sense) => {
            if (senses.indexOf(sense.friendlySubtypeName) === -1) {
                let name = sense.friendlySubtypeName;
                if(sense.value != null) name += ' '+sense.value+' ft.'
                senses.push(name);
            }
        });
        actor.data.traits.senses.value = senses.join(', ');

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
            if (profs.length > 0) { actor.data.abilities[abl].proficient = '1'; }
            else { actor.data.abilities[abl].proficient = '0'; }

            actor.data.abilities[abl].value = this.getTotalAbilityScore(character, this._getConfig('abilities', 'short', abl).id).toString();
            actor.data.abilities[abl].min = 0;
            actor.data.abilities[abl].mod = Math.floor((actor.data.abilities[abl].value - 10) / 2);
            actor.data.abilities[abl].save = Math.floor((actor.data.abilities[abl].value - 10) / 2);

            if(actor.data.abilities[abl].proficient === '1') {
                actor.data.abilities[abl].save += actor.data.attributes.prof.value;
            }
        }

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

            // if(actor.items.filter(it => it.name === item.name).length > 0) {
            //     const it = actor.items.filter(it => it.name === item.name)[0];
            //     actorEntity.updateOwnedItem(it, Object.assign(it, item));
            // } else {
            //     actorEntity.createOwnedItem(item, true);
            // }
            items = items.concat([item]);

            if (actor.data.attributes.spellcasting.value === '') {
                if (charClass.spellCastingAbilityId != null) {
                    actor.data.attributes.spellcasting.value = this._getConfig('abilities', 'id', charClass.spellCastingAbilityId).short;
                } else if (charClass.subclassDefinition != null) {
                    if (charClass.subclassDefinition.spellCastingAbilityId != null) {
                        actor.data.attributes.spellcasting.value = this._getConfig('abilities', 'id', charClass.subclassDefinition.spellCastingAbilityId).short;
                    }
                }

                if(actor.data.attributes.spellcasting.value !== '') {
                    actor.data.attributes.spelldc.value = 8 + actor.data.abilities[actor.data.attributes.spellcasting.value].mod + actor.data.attributes.prof.value;
                }
            }
        });

        // Set Skills / Passive Perception
        for(let skl in actor.data.skills) {
            let skill = actor.data.skills[skl];
            const skillData = this._getObjects(character, 'friendlySubtypeName', skill.label);
            const prof = skillData.filter(sp => sp.type === 'proficiency').length > 0;
            const exp = skillData.filter(sp => sp.type === 'expertise').length > 0;
            const bonus = skillData.filter(sb => sb.type === 'bonus').reduce((total, skillBon) => {
                let bon = 0;
                if (skillBon.value != null) {
                    bon = skillBon.value;
                } else if (skillBon.statId != null) {
                    bon = actor.data.abilities[this._getConfig('abilities', 'id', skillBon.statId).short].mod;
                }
                return total + bon;
            }, 0) + (prof ? actor.data.attributes.prof.value + (exp ? actor.data.attributes.prof.value : 0) : 0);

            skill.value = (prof ? 1 + (exp ? 1 : 0) : 0);
            skill.mod = actor.data.abilities[skill.ability].mod + bonus;

            // passive perception
            if(skill.label === 'Perception') {
                actor.data.traits.perception.value = 10 + skill.mod;
            }

            actor.data.skills[skl] = skill;
        }

        this.parseItems(actorEntity, items);
        actorEntity.update(actor, true);

        setTimeout(() => {
            actorEntity.update({['data.details.biography.value']: biography}, true);
        }, 200);
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
                if(character.classSpells[i].characterClassId === currentClass.id) {
                    character.classSpells[i].spells.forEach((spell) => {
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
        let weaponCritRange = 20;
        let criticalRange = 20;
        let items = [];

        const inventory = character.inventory;
        if(inventory != null) {
            let shieldEquipped = false;
            let hasArmor = false;
            inventory.forEach((item, i) => {
                if (item.definition.type === 'Shield' && item.equipped) shieldEquipped = true;
                if (["Light Armor", "Medium Armor", "Heavy Armor"].indexOf(item.definition.type) >= 0 && item.equipped) hasArmor = true;
            });
            inventory.forEach((item, i) => {
                console.log('beyond: found inventory item ' + item.definition.name);

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

                if (!isWeapon && !isArmor && !isConsumable) {
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

        return {
            ac: ac,
            items: items
        };
    }

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
            return false;
        });
        if(it.length > 0) {
            actorEntity.updateOwnedItem(it, items[i]);
        }
        else {
            actorEntity.createOwnedItem(items[i], true);
        }

        setTimeout(() => {
            if(items.length > i + 1) {
                setTimeout(() => {
                    this.parseItems(actorEntity, items, i + 1);
                }, 200);
            }
        }, 200);
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
            modifiers = this._getObjects(character, '', this._getConfig('abilities', 'id', scoreId).long + "-score");
        if (override > 0) total = override;
        if (modifiers.length > 0) {
            let used_ids = [];
            for (let i = 0; i < modifiers.length; i++){
                if (modifiers[i].type == 'bonus' && used_ids.indexOf(modifiers[i].id) == -1) {
                    total += modifiers[i].value;
                    used_ids.push(modifiers[i].id);
                }
            }
        }

        return total;
    }

    /**
     * Return an array of objects according to key, value, or key and value matching, optionally ignoring objects in array of names
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

let ddbi = new BeyondImporter();
ddbi.render();

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
    ]
};