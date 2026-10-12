import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

// The reaction-clip catalogue every client renders its sound buttons from.
export async function GET() {
  try { return json(await store.listSounds()) }
  catch (err) { return sendErr(err) }
}
