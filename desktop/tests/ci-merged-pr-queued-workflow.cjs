'use strict'

// Run the exact trusted-workflow contract in the repository's standard
// Desktop Tests CI job, not only on the later merged-PR cleanup event.
require('../../scripts/ci/cancel-merged-pr-workflow-contract.test.cjs')
