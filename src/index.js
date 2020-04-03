import state from './state'
import actions from './actions'
import effects from './effects'

export default function (namespace) {
  return {
    state,
    effects,
    actions: actions(namespace)
  }
}
