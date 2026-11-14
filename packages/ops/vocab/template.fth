\ Copyright 2026 Darkcollective, LLC. Licensed under the Apache License, Version 2.0.
\ template: Template, CyberChef's rendering of a Handlebars template against JSON input. CyberChef compiles the template
\ with the Handlebars library, which generates JavaScript and runs it with `new Function`; Forge renders a
\ documented subset with the private primitive template:_render (src/prims/template.ts), which walks a parsed tree
\ and runs no code. The JSON is read by the shared json words.
IN: template

USING: json ;

: render ( data:str template:str="" -- str )
  "Render a Handlebars template with the JSON input as its data, as CyberChef's Template does. Supported (the rest is E_COERCE with the line and column): {{path}} (HTML-escaped: & < > \" ' ` = become entities), {{{path}}} and {{& path}} (raw), comments {{! }} and {{!-- --}}, \\{{ for a literal {{; paths a.b.c, a/b, this, ., ../parent, a.[odd key], list indexes (items.[0]), length of a list or string, @root, @index, @key, @first and @last; the helpers {{#if x}}...{{else if y}}...{{else}}...{{/if}} (with includeZero=true), unless, each (lists and objects, {{else}} for empty, as |item index| block parameters), with, and lookup (inline or as (lookup a b)); Mustache sections {{#name}}...{{/name}} (a list loops, true keeps the context, an object becomes the context, false or missing renders the {{else}} part) and inverted sections {{^name}}...{{/name}}; white-space control {{~x~}} and the Handlebars rule that a block tag or a comment alone on its line removes the line. Not supported: partials, decorators, raw blocks, custom helpers (a name with arguments is a missing helper), log and the compat and strict modes. Only a value's own properties are read. A float prints as JavaScript prints it (1.0 is 1), null and a missing value as nothing, a list as its items joined with commas, an object as [object Object]. The JSON is read by the shared strict parser (a repeated key or malformed text is E_COERCE). No code is generated or run: blocks nested deeper than 100 levels or output past the value limit is E_LIMIT_VALUE, and more than 5,000,000 render steps is E_LIMIT_STEPS." doc
  "Extractors" category
  data json:parse template template:_render ;

META: render
  use-when "You have a JSON document and a text template with {{name}} placeholders, and want the template filled in from the document, as a Handlebars report." ;
  param template "The template, for example Hello {{name}}! {{#each items}}{{@index}}: {{this}} {{/each}}" ;
  expects "JSON text" ;
  checks input utf8 ;
  checks output utf8 ;
;
