import vine from '@vinejs/vine'
import { locationFilter } from '#validators/ranking'

export const importValidator = vine.create({
  url: vine.string().trim().url(),
  regionFilter: vine.array(locationFilter).optional(),
})
