import request from 'request'
import { spawn } from 'child_process'
import { Module, ProgressMessageResponse } from '../types'
import { ProgressPromise, ProgressResponse } from '../utils'

export type AudioProgress = ProgressResponse & { wu: number; silence: number }

export class SpeechRecognition implements Module {
  async init(): Promise<void> {
    spawn(
      'whisper.cpp/server',
      ['--convert', '-m', 'models/ggml-tiny.en.bin'],
      { detached: true }
    )
    // @ts-ignore
    this.NodeMic = (await import('node-mic')).default
  }

  listenRecognize(): ProgressPromise<string, ProgressMessageResponse> {
    return new ProgressPromise(async (resolve, _, progress) => {
      const recording = this.listen()
      recording.progress(progress)
      const raw_audio = await recording
      progress({ type: 'message', message: 'recognizing...' })
      resolve(await this.recognize(raw_audio))
    })
  }

  listen(): ProgressPromise<Buffer, ProgressMessageResponse> {
    return new ProgressPromise(async (resolve, _, progress) => {
      //      progress({ type: 'message', message: 'listening...' })

      // @ts-ignore
      const mic = new this.NodeMic({
        rate: 16000,
        channels: 1,
        threshold: 10,
        debug: false,
      })

      const micInputStream = mic.getAudioStream()

      micInputStream.on('silence', () => {
        mic.stop()
      })

      micInputStream.on('progress', ({ silence, wu }) => {
        progress({
          type: 'message',
          message: 'listening... ' + silence + ' ' + '*'.repeat(wu / 500),
        })
      })

      let totalData = Buffer.from([])
      micInputStream.on('data', (data) => {
        totalData = Buffer.concat([totalData, data])
      })

      micInputStream.on('stopped', () => {
        micInputStream.removeAllListeners()
        resolve(totalData.slice(0, totalData.length - 6 * 256))
      })

      mic.start()
    })
  }

  recognize(pcm_data: Buffer): Promise<string> {
    return new Promise(async (resolve) => {
      request.post(
        {
          url: 'http://localhost:8080/inference',
          formData: {
            name: 'file',
            temperature: '0.2',
            file: pcm_data,
            filename: 'samplefilename',
          },
        },
        (err, res, body) => {
          resolve(
            JSON.parse(body.toString())
              .text.replace(/\[.*?\]/g, '')
              .trim()
          )
        }
      )
    })
  }
}

export default SpeechRecognition
