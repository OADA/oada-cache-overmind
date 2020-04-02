import { createOvermindMock } from 'overmind'
import * as config from '../src'

import chai from 'chai';
let expect = chai.expect;

describe('Actions', () => {
  describe('test', () => {
    it('should set test data in state', async () => {
      const {state, actions, effects} = createOvermindMock(config)
      console.log('overmind', effects)
      await actions.test('1')

      expect(state).to.equal({
        cyrus: true
      })
    })
  })
})
