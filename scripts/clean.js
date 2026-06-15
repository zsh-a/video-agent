#!/usr/bin/env bun

import {$} from 'bun'

await $`rm -rf dist tsconfig.tsbuildinfo packages/*/dist packages/*/*.tsbuildinfo`
