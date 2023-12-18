import * as fs from 'fs'
import * as path from 'path'
import * as os from 'node:os'
import { spawn } from 'child_process'
import events from 'events'
import request from 'request'
import readline from 'readline'

import * as pty from 'node-pty'

import * as g from './generator'
import * as voice from './voice'
import * as types from './types'

import SpeechRecognition from './modules/speechRecognition'
import { AudioProgress } from './modules/speechRecognition'

const shell = 'bash'
const calibStr = '☢calibrating capture☢'
const terminator = '☃'

type Env = {
  trimBefore: number
  trimAfter: number
  stdout: events.EventEmitter
  ptyProcess: pty.IPty
  gpt: Gpt
  speechRecognition: SpeechRecognition
}

function log(...messages) {
  messages = messages.map((m) =>
    typeof m === 'object' ? JSON.stringify(m) : m
  )
  fs.appendFileSync(
    'log.log',
    `${new Date().toISOString()} ${messages.join()}\n`
  )
}

async function hookPS(env) {
  console.log('embedding terminator...')
  await execCommand(env, 'PS1="' + terminator + '$(echo $PS1)"\n')
}

async function calibrateCapture(env: Env) {
  console.log('calibrating capture...')
  const res = await execCommand(env, 'echo -e ' + calibStr)

  env.trimBefore = res.indexOf(calibStr) + 1
  env.trimAfter = res.length - (res.indexOf(calibStr) + calibStr.length) - 2

  const calibratedRes = await execCommand(env, 'echo -e ' + calibStr)
  // console.log(
  //   'calibrated to:',
  //   env.trimBefore,
  //   env.trimAfter,
  //   "string is: '" + calibratedRes + "'"
  // )
  return true
}

function execCommand(env: Env, cmd: string): Promise<string> {
  return new Promise(async (resolve: any) => {
    let res: string = ''
    function dataListener(data: string) {
      res += data
      const finishIndex = res.indexOf(terminator)
      if (finishIndex != -1) {
        env.stdout.removeListener('data', dataListener)
        resolve(
          res.slice(env.trimBefore, finishIndex - env.trimAfter).trim() + '\n'
        )
      }
    }
    env.ptyProcess.write(cmd)
    await timer(50)
    env.stdout.on('data', dataListener)
    env.ptyProcess.write('\n')
  })
}

const timer = (ms) => new Promise((res) => setTimeout(res, ms))

//function box(str: string) {
//  process.stdout.write('\n')
//  process.stdout.write(str)
//}

let prevBoxLen = 0

function box(str: string) {
  const newBoxLen = str.length
  if (newBoxLen < prevBoxLen) {
    str = ' '.repeat(prevBoxLen - str.length) + str
  }
  prevBoxLen = newBoxLen
  const width = process.stdout.columns
  process.stdout.write('\x1b[s') // Save cursor position
  process.stdout.write(`\x1b[${width - str.length}G${str}`) // Move to right and print
  process.stdout.write('\x1b[u') // Restore cursor position
}

function box_(str: string) {
  const width = process.stdout.columns
  const height = process.stdout.rows

  const boxWidth = 24 // fixed width
  const textPadding = Math.floor((boxWidth - str.length) / 2)
  const boxHeight = 3 // fixed height

  const topLeftCol = Math.floor((width - boxWidth) / 2)
  const topLeftRow = Math.floor((height - boxHeight) / 2)

  process.stdout.write('\x1b[s') // save cursor position

  // draw box top border with corners
  process.stdout.write(
    `\x1b[${topLeftRow};${topLeftCol}H\u250C${'\u2500'.repeat(
      boxWidth - 2
    )}\u2510`
  )

  // draw box sides
  for (let i = 0; i < boxHeight - 2; i++) {
    if (i === Math.floor((boxHeight - 2) / 2)) {
      // draw your string in the middle of the box
      process.stdout.write(
        `\x1b[${topLeftRow + i + 1};${topLeftCol}H\u2502${' '.repeat(
          textPadding
        )}${str}${' '.repeat(boxWidth - str.length - textPadding - 2)}\u2502`
      )
    } else {
      process.stdout.write(
        `\x1b[${topLeftRow + i + 1};${topLeftCol}H\u2502${' '.repeat(
          boxWidth - 2
        )}\u2502`
      )
    }
  }

  // draw box bottom border with corners
  process.stdout.write(
    `\x1b[${topLeftRow + boxHeight - 1};${topLeftCol}H\u2514${'\u2500'.repeat(
      boxWidth - 2
    )}\u2518`
  )

  process.stdout.write('\x1b[u') // restore cursor position
}

function awaitSomething(env): Promise<void> {
  return new Promise((resolve) => {
    function dataListener(data: string) {
      env.stdout.removeListener('data', dataListener)
      resolve()
    }
    env.stdout.on('data', dataListener)
  })
}

function spawnChild() {
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: process.stdout.columns,
    rows: process.stdout.rows,
    cwd: process.env.HOME,
    env: process.env,
  })

  // @ts-ignore
  ptyProcess.onExit(({ code }) => {
    process.exit(code)
  })

  return ptyProcess
}

async function speak(env: Env, text: string): Promise<void> {
  //console.log('\nSPEAK', text, '\n')
  await voice.asyncMplay(await voice.generateChunk(text))
}

type SectionCommandResult = {
  output: string
  command: string
}

type SectionResult = SectionCommandResult | null

function renderSectionOutput(section: SectionResult): string {
  if (section === null) {
    return ''
  }
  const { output, command } = section

  function checkEmpty(str: string) {
    if (str.trim() === '') {
      return 'command did not have any output'
    }
    return str
  }
  return (
    "output of '" + command + "'\n" + '```\n' + checkEmpty(output) + '\n```'
  )
}

async function agentLoop(env: Env, message: string) {
  //console.log('\nASK', message)
  const response = await env.gpt.ask(message)
  box('thinking...')
  log('RESPONSE', response)
  //console.log('\nRESPONSE', response)

  async function consumeSection(
    section: ResponseSection,
    last: Boolean
  ): Promise<SectionResult> {
    if (section.type === 'text') {
      console.log('\nagent>', section.content)
      //      await speak(env, section.content)
      return null
    } else {
      if (section.language === 'sh') {
        box('executing...')
        return {
          output: await execCommand(env, section.content),
          command: section.content,
        }
      } else if (
        section.language &&
        (section.language.trim() === 'speak' ||
          section.language.trim() === 'speech')
      ) {
        box('speaking...')
        await speak(env, section.content)
        return null
      } else {
        console.log('\n unknown language section:\n', section.content, '\n')
        return null
      }
    }
  }

  const reply: Array<string> = []

  // go through sections of response
  for (const [index, section] of response.entries()) {
    const output = await consumeSection(section, index === response.length - 1)
    if (output) {
      reply.push(renderSectionOutput(output))
    }
  }

  if (reply.length) {
    agentLoop(env, reply.join('\n'))
  } else {
    box('agent finished')
  }
}

async function terminal() {
  const stdout = new events.EventEmitter()
  const ptyProcess = spawnChild()
  const env: Env = {
    trimBefore: 0,
    trimAfter: 0,
    stdout,
    ptyProcess,
    gpt: new Gpt(),
    speechRecognition: new SpeechRecognition(),
  }

  ptyProcess.onData((data) => {
    stdout.emit('data', data)
  })

  await env.speechRecognition.init()
  await env.gpt.init()
  await awaitSomething(env)
  await hookPS(env)
  await calibrateCapture(env)

  //  const output = await execCommand(env, 'id --version')
  //  console.log(output)

  console.log('enabling passthrough...')

  process.stdin.setRawMode(true)

  env.stdout.on('data', (data) => {
    process.stdout.write(data)
  })

  ptyProcess.write('\n')

  readline.emitKeypressEvents(process.stdin)

  process.stdin.on('keypress', async (str, key) => {
    if (key.ctrl && key.name === 's') {
      const recognitionTask = env.speechRecognition.listenRecognize()
      recognitionTask.progress((progress) => {
        box(progress.message)
      })

      const raw_text = await recognitionTask
      console.log('user>', raw_text)
      agentLoop(env, raw_text)
    }
  })

  process.stdin.on('data', (data) => {
    env.ptyProcess.write(data.toString())
  })
}

async function initGPT(): Promise<any> {}

type ResponseSection = {
  type: 'text' | 'code'
  content: string
  language?: string
}

type Response = Array<ResponseSection>

class Gpt implements types.Module {
  prevId?: string = undefined
  api?: object
  async init(): Promise<void> {
    const { ChatGPTAPI } = await import('chatgpt')

    const systemMessage = fs.readFileSync('systemMessage.md', 'utf-8')

    this.api = new ChatGPTAPI({
      apiKey: process.env.OPENAI_API_KEY || '',
      systemMessage,
      completionParams: {
        model: 'gpt-4',
        temperature: 0.2,
      },
    })
  }

  splitMarkdown(md): Response {
    const sections = md.split('```')
    return sections
      .map((section, index) => {
        const isCodeBlock = index % 2 !== 0
        const lines = section.split('\n')
        let language = null
        let contentLines = lines

        if (isCodeBlock && lines.length > 1) {
          ;[language, ...contentLines] = lines
        }

        const content = contentLines.join('\n').trim()

        if (content.length === 0) {
          return null
        }
        return {
          type: isCodeBlock ? 'code' : 'text',
          content,
          language,
        }
      })
      .filter(Boolean)
  }

  async ask(text: string): Promise<Response> {
    // @ts-ignore
    const res = await this.api.sendMessage(text, {
      parentMessageId: this.prevId,
    })

    this.prevId = res.id
    log('RAW', res.text)

    return this.splitMarkdown(res.text)
  }
}

async function test() {
  const gpt = new Gpt()
  console.log(
    gpt.splitMarkdown(fs.readFileSync('exampleResponse2.txt', 'utf-8'))
  )
}

//test()

terminal()
