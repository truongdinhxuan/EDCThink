import { join } from 'node:path'
import AutoLoad, { AutoloadPluginOptions } from '@fastify/autoload'
import { FastifyPluginAsync, FastifyServerOptions } from 'fastify'
import { getTrustProxyOption } from './config/server'
export interface AppOptions extends FastifyServerOptions, Partial<AutoloadPluginOptions> {

}
// Loaded by fastify-cli only when the start command passes --options.
const options: AppOptions = {
  // Decides what request.ip resolves to, which keys the rate limiter and fills
  // auth_sessions.ip_address. See src/config/server.ts.
  trustProxy: getTrustProxyOption(),
}

const app: FastifyPluginAsync<AppOptions> = async (
  fastify,
  opts
): Promise<void> => {
  // Place here your custom code!

  // Do not touch the following lines

  // This loads all plugins defined in plugins
  // those should be support plugins that are reused
  // through your application
  // eslint-disable-next-line no-void
  void fastify.register(AutoLoad, {
    dir: join(__dirname, 'plugins'),
    options: opts
  })

  // This loads all plugins defined in routes
  // define your routes in one of these
  // eslint-disable-next-line no-void
  void fastify.register(AutoLoad, {
    dir: join(__dirname, 'routes'),
    options: opts
  })
}
export default app
export { app, options }
