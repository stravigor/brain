import { ServiceProvider } from '@stravigor/kernel'
import type { Application } from '@stravigor/kernel'
import BrainManager from './brain_manager.ts'

export default class BrainProvider extends ServiceProvider {
  readonly name = 'brain'
  override readonly dependencies = ['config']

  override register(app: Application): void {
    app.singleton(BrainManager)
  }

  override boot(app: Application): void {
    app.resolve(BrainManager)
  }
}
