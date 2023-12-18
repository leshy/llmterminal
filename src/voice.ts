#!/usr/bin/env -S npm run tsn -T
import OpenAI, { toFile } from 'openai'
import fs from 'fs'
import path from 'path'
import events from 'events'
import crypto from 'crypto'

import * as g from './generator'
import { spawn } from 'child_process'
import { flow } from 'lodash/fp'
const play = require('audio-play')

// gets API Key from environment variable OPENAI_API_KEY
const openai = new OpenAI()

type BufferDecoder = (buffer: ArrayBuffer) => Promise<AudioBuffer>

let counter = 0

const hash = (input: string): string => {
  counter += 1
  return (
    '0'.repeat(3 - counter.toString().length) +
    counter +
    '-' +
    crypto.createHash('md5').update(input).digest('hex')
  )
}

type AudioRenderer = (input: string) => Promise<Buffer>

const singleChunk = (
  maxsize: number,
  input: string
): [string, string | void] => {
  if (input.length < maxsize) {
    return [input, undefined]
  }

  const chunk = input.slice(0, maxsize)
  const dotIndex = Math.max(chunk.lastIndexOf('. '), chunk.lastIndexOf('.\n'))

  if (dotIndex == -1) {
    return [chunk, input.slice(maxsize)]
  } else {
    return [input.slice(0, dotIndex + 1), input.slice(dotIndex + 2)]
  }
}

const cacheWrapper = (func: AudioRenderer) => {
  const generateAndCache = async (
    func: AudioRenderer,
    input: string,
    path: string
  ) => {
    const audio = await func(input)
    await fs.promises.writeFile(path, audio)
    return audio
  }

  return async (input: string) => {
    const path = `cache/${hash(input)}.mp3`
    const audio: Buffer = fs.existsSync(path)
      ? fs.readFileSync(path)
      : await generateAndCache(func, input, path)
    //    await fs.promises.appendFile('total.mp3', audio)
    return path
  }
}

export const generateChunk = cacheWrapper(
  async (input: string): Promise<Buffer> => {
    const mp3request = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'onyx',
      input,
    })
    return Buffer.from(await mp3request.arrayBuffer())
  }
)

export async function* tts(inputs: AsyncGenerator<string>) {
  for await (let input of inputs) {
    yield await generateChunk(input)
  }
}

export function chunkText(maxsize: number) {
  async function* chunker(inputStream: AsyncGenerator<string>) {
    for await (let input of inputStream) {
      let current: string | void = input
      let chunk: string
      ;[chunk, current] = singleChunk(maxsize, input)

      while (current) {
        yield chunk
        ;[chunk, current] = singleChunk(maxsize, current)
      }
      yield chunk
    }
  }
  return chunker
}

export function asyncMplay(mp3file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('mplayer', [mp3file], { stdio: 'ignore' })
    child.on('exit', (code: number) => {
      if (code !== 0) {
        reject(new Error(`exited with code ${code}`))
      } else {
        resolve()
      }
    })
  })
}

export async function mplayer(mp3files: AsyncGenerator<string>) {
  for await (let mp3file of mp3files) {
    await asyncMplay(mp3file)
  }
}
