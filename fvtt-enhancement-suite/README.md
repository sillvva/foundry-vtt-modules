# Foundry VTT Enhancement Suite

## Installation Instructions

To install a module, follow these instructions:

1. Download the zip file included in the module directory. If one is not provided, the module is still in early development.
2. Extract the included folder to `public/modules` in your Foundry Virtual Tabletop installation folder.
3. Restart Foundry Virtual Tabletop. 

## Macros

### Custom Chat Macros

##### Actor attributes

Chat macros support actor data and inline dice rolls.

Actor data can be included in a chat macro by enclosing one of the following attributes in a pair of double curly braces.

```
{{name}} is level {{level}}
```

* `ac`
* `acrobatics`
* `alignment`
* `animal-handling`
* `arcana`
* `athletics`
* `background`
* `cha.mod`
* `cha.save`
* `cha`
* `class1.level` - class# can be incremented as needed
* `class1.subclass` - class# can be incremented as needed
* `class1` - class# can be incremented as needed
* `con.mod`
* `con.save`
* `con`
* `condition-immunities`
* `currency.cp`
* `currency.gp`
* `currency.pp`
* `currency.sp`
* `damage-immunities`
* `damage-resistances`
* `damage-vulnerabilities`
* `deception`
* `dex.mod`
* `dex.save`
* `dex`
* `hd`
* `history`
* `hp.max`
* `hp`
* `init.mod`
* `init`
* `insight`
* `int.mod`
* `int.save`
* `int`
* `intimidation`
* `investigation`
* `languages`
* `level`
* `medicine`
* `name`
* `nature`
* `perception`
* `perception`
* `performance`
* `persuasion`
* `primary.max`
* `primary`
* `prof`
* `race`
* `religion`
* `secondary.max`
* `secondary`
* `senses`
* `size`
* `sleight-of-hand`
* `spell1.max` - spell# can be incremented as needed
* `spell1` - spell# can be incremented as needed
* `spellcasting`
* `spelldc`
* `stealth`
* `str.mod`
* `str.save`
* `str`
* `survival`
* `wis.mod`
* `wis.save`
* `wis`
* `xp.max`
* `xp`

##### Inline Prompts

Parse a message for input requests. Prompt tags with the same query will only prompt once and use the same value each additional time the query is requested.

<caption>Text input example</caption>

```
// default value is an empty string if omitted
?{Query|default value (optional)}
```

<caption>Dropdown examples</caption>

```
?{Query|option 1 label,option 1 value|option 2 label,option 2 value|...}
?{[list]Query|option 1 label,option 1 value|option 2 label,option 2 value|...}
```

<caption>Radio button example</caption>

```
?{[radio]Query|option 1 label,option 1 value|option 2 label,option 2 value|...}
```

<caption>Checkbox examples</caption>

```
// A normal example. Returns a comma-separated list of selected options
?{[checkbox]Query|option 1 label,option 1 value|option 2 label,option 2 value|...}
// The delimiter that separates the selected options can be specified
?{[checkbox|+]Query|option 1 label,option 1 value|option 2 label,option 2 value|...}
// Or it can be removed
?{[checkbox|]Query|option 1 label,option 1 value|option 2 label,option 2 value|...}

// A selected option can be referenced again later. Returns "option 1 value" if option 1 was selected.
?{:option 1 label}
```

<caption>Repeating a query to get the same value multiple times</caption>

```
 // prompts for a dropdown input
?{Query|option 1 label,option 1 value|option 2 label,option 2 value|...}
 // identical query retrieves original response
?{Query}
```

##### Inline Dice Rolls and Math

Inline dice rolls are also supported. The math formula parser allows formats supported by [mathjs.org](http://mathjs.org/). Here are a few examples:

```
{{name}} sneak attacks for an additional [[<<ceil({{level}}/2)>>d6]] damage!
Output: Drugol sneak attacks for an additional 11 damage!
```

Inline dice rolls like this will have a tooltip on the roll to view the formula.

Alternatively, these formulas can be used in roll commands.

```
/roll <<ceil({{level}}/2)>>d6
Output: /roll 3d6
```

Here are a few more examples:

```
[[ceil(3d6 / 2) + 5]]
```

```
[[3d6+4]]
```

<caption>And math:</caption>

```
<<ceil(5/2)>>
```

<caption>And unit conversions:</caption>

```
<<10ft to m>>
```

<caption>**Note:** This does not work.</caption>

```
[[ceil(5/2)d6]]
```

<caption>This does:</caption>

```
[[<<ceil(5/2)>>d6]]
```
<!--stackedit_data:
eyJoaXN0b3J5IjpbLTIxMTA4NTgxNzgsLTc5MDAxODcyNl19
-->
