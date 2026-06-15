#!/usr/bin/env bun

import {rm} from 'node:fs/promises'

await rm('oclif.manifest.json', {force: true})
