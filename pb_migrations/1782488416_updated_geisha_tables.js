/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_137663374")

  // update field
  collection.fields.addAt(5, new Field({
    "hidden": false,
    "id": "g_t_section",
    "maxSelect": 1,
    "name": "section",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "Main",
      "Window",
      "VIP",
      "Bar",
      "Outdoor",
      "Front right section",
      "Middle section",
      "Front left section",
      "Back right section",
      "Back left section",
      "Counter section",
      "Front Section",
      "Middle Section",
      "Back Section",
      "Counter table",
      "Bar Area",
      "Outside Area"
    ]
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_137663374")

  // update field
  collection.fields.addAt(5, new Field({
    "hidden": false,
    "id": "g_t_section",
    "maxSelect": 1,
    "name": "section",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "Main",
      "Window",
      "VIP",
      "Bar",
      "Outdoor"
    ]
  }))

  return app.save(collection)
})
