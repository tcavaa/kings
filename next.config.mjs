/** @type {import('next').NextConfig} */
const nextConfig = {
  // King Online never ran under StrictMode (double-invoked dev effects would
  // open a second game socket); the score app opts in itself, exactly like
  // its old main.jsx did. Production behaviour is unaffected either way.
  reactStrictMode: false,
  // The API routes share the game server's CommonJS store (server/db), which
  // talks to Supabase through the postgres driver — keep it unbundled.
  serverExternalPackages: ['postgres'],
};

export default nextConfig;
