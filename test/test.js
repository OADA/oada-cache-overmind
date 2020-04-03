var _ = require('lodash')

function it(om) {
  return _.mapValues(om, (v) => {
    return v + 'cyrus';
  })
}

function test(om) {
  const {a: aa, b} = it(om);
  console.log(aa)
}

test({a: 'bacon', b: 'sauce'});
