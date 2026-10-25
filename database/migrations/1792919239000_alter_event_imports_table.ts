import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'event_imports'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.boolean('league_filter').notNullable().defaultTo(false)
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('league_filter')
    })
  }
}
