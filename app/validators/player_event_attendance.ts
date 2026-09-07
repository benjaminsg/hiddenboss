import vine from '@vinejs/vine'

export const addPlayerEventAttendanceValidator = vine.create({
  eventId: vine.string().uuid(),
})
