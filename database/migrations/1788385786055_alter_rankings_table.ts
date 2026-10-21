import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'rankings'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.jsonb('residency_requirements').notNullable().defaultTo('[]')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('residency_requirements')
    })
  }
}
