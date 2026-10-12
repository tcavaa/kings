import store from '@/server/db/store'
import { json, publicProfile, sendErr } from '@/lib/api/http'

export async function GET() {
  try {
    const profiles = await store.listProfiles()
    return json(profiles.map(publicProfile))
  } catch (err) { return sendErr(err) }
}
