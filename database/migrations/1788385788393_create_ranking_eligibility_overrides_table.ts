import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'ranking_eligibility_overrides'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().notNullable()
      table
        .uuid('ranking_id')
        .notNullable()
        .references('id')
        .inTable('rankings')
        .onDelete('CASCADE')
      table
        .uuid('league_player_id')
        .notNullable()
        .references('id')
        .inTable('league_players')
        .onDelete('CASCADE')

      /** `exempt` forces eligible regardless of the computed rules; `exclude` forces ineligible. */
      table.string('kind').notNullable()

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['ranking_id', 'league_player_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
