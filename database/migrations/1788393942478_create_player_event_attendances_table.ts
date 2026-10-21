import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'player_event_attendances'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.uuid('id').primary().notNullable()
      table
        .uuid('league_player_id')
        .notNullable()
        .references('id')
        .inTable('league_players')
        .onDelete('CASCADE')
      table.uuid('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE')

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').nullable()

      table.unique(['league_player_id', 'event_id'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
