import Foundation
import AudioToolbox
import Synchronization
import AVFoundation
import Darwin
import CoreFoundation

func diagnostic(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

func audioError(_ message: String) -> NSError {
    NSError(domain: "JARVISAudio", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message])
}

typealias AudioCaptureCallback = AURenderCallback
typealias AudioPlaybackCallback = AURenderCallback

func loadSpeechSamples(from path: String) throws -> [Float] {
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: path),
                              commonFormat: .pcmFormatFloat32, interleaved: false)
    let source = file.processingFormat
    let duration = Double(file.length) / source.sampleRate
    guard source.sampleRate > 0, duration.isFinite, duration > 0, duration <= 60,
          source.channelCount == 1 || source.channelCount == 2,
          let target = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                     sampleRate: 44100, channels: 1, interleaved: false),
          let converter = AVAudioConverter(from: source, to: target),
          let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: 4096),
          let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: 4096) else {
        throw audioError("Speech must be nonempty mono/stereo audio, at most 60 seconds")
    }
    var samples: [Float] = []
    samples.reserveCapacity(Int(ceil(duration * 44100)) + 4096)

    let maxIterations = Int(ceil(duration * 44100 / 4096)) + 32
    for _ in 0..<maxIterations {
        var conversionError: NSError?
        var readError: Error?
        output.frameLength = 0
        let status = converter.convert(to: output, error: &conversionError) { requested, state in
            guard file.framePosition < file.length else {
                state.pointee = .endOfStream
                return nil
            }
            do {
                try file.read(into: input, frameCount: min(requested, input.frameCapacity))
                guard input.frameLength > 0 else {
                    state.pointee = .endOfStream
                    return nil
                }
                state.pointee = .haveData
                return input
            } catch {
                readError = error
                state.pointee = .endOfStream
                return nil
            }
        }
        if let readError { throw readError }
        if let conversionError { throw conversionError }
        guard status != .error else { throw audioError("Speech conversion failed") }
        let count = Int(output.frameLength)
        let data = output.floatChannelData![0]
        for index in 0..<count {
            guard data[index].isFinite else { throw audioError("Speech contains invalid samples") }
            samples.append(max(-1, min(1, data[index])))
        }
        guard samples.count <= 44100 * 60 else { throw audioError("Converted speech exceeds 60 seconds") }
        if status == .endOfStream {
            guard !samples.isEmpty else { throw audioError("Speech file contains no samples") }
            return samples
        }
    }
    throw audioError("Speech conversion did not finish")
}

func saveMicrophoneRecording(
    context: AudioCaptureContext,
    to path: String
) throws {
    let frameCount = context.recordedFrameCount.load(ordering: .relaxed)

    guard frameCount > 0 else {
        throw NSError(
            domain: "JARVISAudio",
            code: 1,
            userInfo: [
                NSLocalizedDescriptionKey: "No microphone audio was recorded."
            ]
        )
    }

    guard let format = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: 44100,
        channels: 1,
        interleaved: false
    ) else {
        throw NSError(
            domain: "JARVISAudio",
            code: 2,
            userInfo: [
                NSLocalizedDescriptionKey: "Could not create recording format."
            ]
        )
    }

    let outputFile = try AVAudioFile(
        forWriting: URL(fileURLWithPath: path),
        settings: format.settings
    )

    guard let buffer = AVAudioPCMBuffer(
        pcmFormat: format,
        frameCapacity: AVAudioFrameCount(frameCount)
    ) else {
        throw NSError(
            domain: "JARVISAudio",
            code: 3,
            userInfo: [
                NSLocalizedDescriptionKey: "Could not allocate recording buffer."
            ]
        )
    }

    buffer.frameLength = AVAudioFrameCount(frameCount)

    guard let channelData = buffer.floatChannelData else {
        throw NSError(
            domain: "JARVISAudio",
            code: 4,
            userInfo: [
                NSLocalizedDescriptionKey: "Could not access recording channel."
            ]
        )
    }

    channelData[0].update(
        from: context.recordingBuffer,
        count: frameCount
    )

    try outputFile.write(from: buffer)
}

func convertMicrophoneAudio(
    context: AudioCaptureContext
) throws -> AVAudioPCMBuffer {
    let frameCount = context.recordedFrameCount.load(ordering: .relaxed)

    guard frameCount > 0 else {
        throw NSError(
            domain: "JARVISAudio",
            code: 5,
            userInfo: [
                NSLocalizedDescriptionKey: "No microphone samples available."
            ]
        )
    }

    guard let inputFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: 44100,
        channels: 1,
        interleaved: false
    ),
    let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: 16000,
        channels: 1,
        interleaved: false
    ) else {
        throw NSError(
            domain: "JARVISAudio",
            code: 6,
            userInfo: [
                NSLocalizedDescriptionKey: "Could not create audio formats."
            ]
        )
    }

    guard let inputBuffer = AVAudioPCMBuffer(
        pcmFormat: inputFormat,
        frameCapacity: AVAudioFrameCount(frameCount)
    ) else {
        throw NSError(
            domain: "JARVISAudio",
            code: 7,
            userInfo: [
                NSLocalizedDescriptionKey: "Could not allocate input buffer."
            ]
        )
    }

    inputBuffer.frameLength = AVAudioFrameCount(frameCount)

    guard let inputData = inputBuffer.floatChannelData else {
        throw NSError(
            domain: "JARVISAudio",
            code: 8,
            userInfo: [
                NSLocalizedDescriptionKey: "Could not access input samples."
            ]
        )
    }

    inputData[0].update(
        from: context.recordingBuffer,
        count: frameCount
    )

    guard let converter = AVAudioConverter(
        from: inputFormat,
        to: outputFormat
    ) else {
        throw NSError(
            domain: "JARVISAudio",
            code: 9,
            userInfo: [
                NSLocalizedDescriptionKey: "Could not create audio converter."
            ]
        )
    }

    let outputCapacity = AVAudioFrameCount(
        ceil(Double(frameCount) * 16000.0 / 44100.0) + 1024
    )

    guard let outputBuffer = AVAudioPCMBuffer(
        pcmFormat: outputFormat,
        frameCapacity: outputCapacity
    ) else {
        throw NSError(
            domain: "JARVISAudio",
            code: 10,
            userInfo: [
                NSLocalizedDescriptionKey: "Could not allocate output buffer."
            ]
        )
    }

    var inputProvided = false
    var conversionError: NSError?

    let status = converter.convert(
        to: outputBuffer,
        error: &conversionError
    ) { _, inputStatus in

        if inputProvided {
            inputStatus.pointee = .endOfStream
            return nil
        }

        inputProvided = true
        inputStatus.pointee = .haveData
        return inputBuffer
    }

    if let conversionError {
        throw conversionError
    }

    guard status != .error, outputBuffer.frameLength > 0 else {
        throw NSError(
            domain: "JARVISAudio",
            code: 11,
            userInfo: [
                NSLocalizedDescriptionKey: "Audio conversion produced no samples."
            ]
        )
    }

    return outputBuffer
}

func saveConvertedPCM(
    buffer: AVAudioPCMBuffer,
    to path: String
) throws {
    guard let channelData = buffer.int16ChannelData else {
        throw NSError(
            domain: "JARVISAudio",
            code: 12,
            userInfo: [
                NSLocalizedDescriptionKey: "Converted buffer is not Int16 PCM."
            ]
        )
    }

    let frameCount = Int(buffer.frameLength)
    let byteCount = frameCount * MemoryLayout<Int16>.size

    let data = Data(
        bytes: channelData[0],
        count: byteCount
    )

    try data.write(to: URL(fileURLWithPath: path))
}

final class AudioCaptureContext: @unchecked Sendable {
    let audioUnit: AudioUnit?
    let maxFrames: UInt32 = 4096
    let bytesPerFrame: UInt32 = 4
    let audioBuffer: UnsafeMutableRawPointer

    let callbackCount = Atomic<UInt64>(0)
    let successfulRenderCount = Atomic<UInt64>(0)
    let nonSilentSampleCount = Atomic<UInt64>(0)
    let playbackCallbackCount = Atomic<UInt64>(0)
    let invalidPlaybackBufferCount = Atomic<UInt64>(0)
    let totalPlaybackFrames = Atomic<UInt64>(0)

    let peakAmplitudeBits = Atomic<UInt32>(0)
    let rmsAmplitudeBits = Atomic<UInt32>(0)
    let totalSampleCount = Atomic<UInt64>(0)
    let totalSumOfSquaresBits = Atomic<UInt64>(0)

    let playbackCapacity = 44100 * 60
    let playbackBuffer: UnsafeMutablePointer<Float>
    let playbackState = Atomic<Int>(0)
    let playbackStopID = Atomic<UInt64>(0)
    var playbackRequestID: UInt64 = 0
    var playbackSampleCount = 0
    var nativePlaybackIndex = 0

    let speechSamples: [Float]
    var speechPlaybackIndex: Int = 0
    let speechDetectionThreshold: Float = 0.01
    let speechDetectedCount = Atomic<UInt64>(0)

    let recordingCapacity = 44100 * 10
    let recordingBuffer: UnsafeMutablePointer<Float>
    let recordedFrameCount = Atomic<Int>(0)

    let streamingCapacity = 44100 * 2
    let streamingBuffer: UnsafeMutablePointer<Float>
    let streamingWritePosition = Atomic<Int>(0)
    let streamingReadPosition = Atomic<Int>(0)
    let streamingDroppedFrames = Atomic<UInt64>(0)

    init(audioUnit: AudioUnit?, speechSamples: [Float]) {
        self.audioUnit = audioUnit
        self.audioBuffer = UnsafeMutableRawPointer.allocate(
            byteCount: Int(maxFrames * bytesPerFrame),
            alignment: MemoryLayout<Float>.alignment
        )
        self.playbackBuffer = UnsafeMutablePointer<Float>.allocate(capacity: playbackCapacity)
        self.playbackBuffer.initialize(repeating: 0, count: playbackCapacity)
        self.speechSamples = speechSamples
        self.recordingBuffer = UnsafeMutablePointer<Float>.allocate(capacity: recordingCapacity)
        self.recordingBuffer.initialize(repeating: 0.0, count: recordingCapacity)
        self.streamingBuffer = UnsafeMutablePointer<Float>.allocate(capacity: streamingCapacity)
        self.streamingBuffer.initialize(repeating: 0.0, count: streamingCapacity)
    }

    deinit {
        playbackBuffer.deinitialize(count: playbackCapacity)
        playbackBuffer.deallocate()
        streamingBuffer.deinitialize(count: streamingCapacity)
        streamingBuffer.deallocate()
        recordingBuffer.deinitialize(count: recordingCapacity)
        recordingBuffer.deallocate()
        audioBuffer.deallocate()
    }
}

let voiceProcessingType = kAudioUnitSubType_VoiceProcessingIO

func writeStreamingSamples(
    samples: UnsafePointer<Float>,
    frameCount: Int,
    buffer: UnsafeMutablePointer<Float>,
    capacity: Int,
    writePositionAtomic: borrowing Atomic<Int>,
    readPositionAtomic: borrowing Atomic<Int>,
    droppedFramesAtomic: borrowing Atomic<UInt64>
) {
    let writePosition = writePositionAtomic.load(ordering: .relaxed)
    let readPosition = readPositionAtomic.load(ordering: .acquiring)
    let availableFrames = (readPosition - writePosition - 1 + capacity) % capacity
    let framesToStream = min(frameCount, availableFrames)

    if framesToStream > 0 {
        let firstCopyCount = min(framesToStream, capacity - writePosition)
        buffer.advanced(by: writePosition)
            .update(from: samples, count: firstCopyCount)

        let secondCopyCount = framesToStream - firstCopyCount
        if secondCopyCount > 0 {
            buffer.update(
                from: samples.advanced(by: firstCopyCount),
                count: secondCopyCount
            )
        }

        writePositionAtomic.store(
            (writePosition + framesToStream) % capacity,
            ordering: .releasing
        )
    }

    let droppedFrames = frameCount - framesToStream
    if droppedFrames > 0 {
        droppedFramesAtomic.wrappingAdd(
            UInt64(droppedFrames), ordering: .relaxed
        )
    }

}

func microphoneCallback(
    inRefCon: UnsafeMutableRawPointer,
    ioActionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
    inTimeStamp: UnsafePointer<AudioTimeStamp>,
    inBusNumber: UInt32,
    inNumberFrames: UInt32,
    ioData: UnsafeMutablePointer<AudioBufferList>?
) -> OSStatus {
    let context = Unmanaged<AudioCaptureContext>
        .fromOpaque(inRefCon)
        .takeUnretainedValue()

    context.callbackCount.wrappingAdd(1, ordering: .relaxed)

    guard inNumberFrames <= context.maxFrames else {
        return kAudio_ParamError
    }

    let bytesPerFrame: UInt32 = 4
    let bufferSize = inNumberFrames * bytesPerFrame
    let audioBuffer = AudioBuffer(
        mNumberChannels: 1, 
        mDataByteSize: bufferSize, 
        mData: context.audioBuffer
    )
    var bufferList = AudioBufferList(
        mNumberBuffers: 1,
        mBuffers: audioBuffer
    )
    guard let unit = context.audioUnit else { return kAudio_ParamError }
    let renderStatus = AudioUnitRender(
        unit,
        ioActionFlags,
        inTimeStamp,
        1,
        inNumberFrames,
        &bufferList
    )

    if (renderStatus == noErr && inNumberFrames > 0) {
        let samples = context.audioBuffer.assumingMemoryBound(to: Float.self)

        writeStreamingSamples(
            samples: UnsafePointer(samples),
            frameCount: Int(inNumberFrames),
            buffer: context.streamingBuffer,
            capacity: context.streamingCapacity,
            writePositionAtomic: context.streamingWritePosition,
            readPositionAtomic: context.streamingReadPosition,
            droppedFramesAtomic: context.streamingDroppedFrames
        )

        let currentFrameCount = context.recordedFrameCount.load(ordering: .relaxed)
        let remainingCapacity = context.recordingCapacity - currentFrameCount

        if (remainingCapacity > 0) {
            let framesToCopy = min(Int(inNumberFrames), remainingCapacity)

            context.recordingBuffer
                .advanced(by: currentFrameCount)
                .update(from: samples, count: framesToCopy)

            context.recordedFrameCount.store(
                currentFrameCount + framesToCopy,
                ordering: .relaxed
            )
        }

        let firstSample = samples[0]
        
        if (abs(firstSample) > 0.001) {
            context.nonSilentSampleCount.wrappingAdd(1, ordering: .relaxed)
        }

        var peakAmplitude: Float = 0.0
        var sumOfSquares: Float = 0.0

        for index in 0..<Int(inNumberFrames) {
            let amplitude = abs(samples[index])
            sumOfSquares += samples[index] * samples[index]

            if (amplitude > peakAmplitude) {
                peakAmplitude = amplitude
            }
        }

        let meanSquare = sumOfSquares / Float(inNumberFrames)
        let rmsAmplitude = sqrt(meanSquare)
        if (rmsAmplitude > context.speechDetectionThreshold) {
            context.speechDetectedCount.wrappingAdd(1, ordering: .relaxed)
        }

        let bufferEnergy = Double(sumOfSquares)

        if bufferEnergy.isFinite {
            let previous = Double(bitPattern: context.totalSumOfSquaresBits.load(ordering: .relaxed))
            let updated = previous + bufferEnergy
            if updated.isFinite {
                context.totalSumOfSquaresBits.store(updated.bitPattern, ordering: .relaxed)
            }
        }

        if (rmsAmplitude.isFinite) {
            let rmsBits = rmsAmplitude.bitPattern
            let previousBits = context.rmsAmplitudeBits.load(ordering: .relaxed)
            if (rmsBits > previousBits) {
                context.rmsAmplitudeBits.store(rmsBits, ordering: .relaxed)
            }
        }

        if (peakAmplitude.isFinite) {
            let peakBits = peakAmplitude.bitPattern
            let previousBits = context.peakAmplitudeBits.load(ordering: .relaxed)
            if (peakBits > previousBits) {
                context.peakAmplitudeBits.store(peakBits, ordering: .relaxed)
            }
        }
    }

    if (renderStatus == noErr) {
        context.successfulRenderCount.wrappingAdd(1, ordering: .relaxed)
        context.totalSampleCount.wrappingAdd(UInt64(inNumberFrames), ordering: .relaxed)
    }

    return renderStatus
}

func renderNativePlayback(context: AudioCaptureContext,
                          into output: UnsafeMutablePointer<Float>, frames: Int) {
    output.update(repeating: 0, count: frames)
    guard context.playbackState.load(ordering: .acquiring) == 1 else { return }
    if context.playbackStopID.load(ordering: .acquiring) == context.playbackRequestID {
        context.nativePlaybackIndex = 0
        context.playbackState.store(3, ordering: .releasing)
        return
    }
    let count = min(frames, context.playbackSampleCount - context.nativePlaybackIndex)
    output.update(from: context.playbackBuffer.advanced(by: context.nativePlaybackIndex), count: count)
    context.nativePlaybackIndex += count
    if context.nativePlaybackIndex == context.playbackSampleCount {
        context.nativePlaybackIndex = 0
        context.playbackState.store(2, ordering: .releasing)
    }
}

func speakerPlaybackCallback(
    inRefCon: UnsafeMutableRawPointer,
    ioActionFlags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
    inTimeStamp: UnsafePointer<AudioTimeStamp>,
    inBusNumber: UInt32,
    inNumberFrames: UInt32,
    ioData: UnsafeMutablePointer<AudioBufferList>?
) -> OSStatus {
    let context = Unmanaged<AudioCaptureContext>
    .fromOpaque(inRefCon)
    .takeUnretainedValue()

    context.playbackCallbackCount.wrappingAdd(
        1,
        ordering: .relaxed
    )

    context.totalPlaybackFrames.wrappingAdd(
        UInt64(inNumberFrames),
        ordering: .relaxed
    )

    guard let ioData else {
        return kAudio_ParamError
    }

    let buffers = UnsafeMutableAudioBufferListPointer(ioData)

    let expectedBytes = Int(inNumberFrames) * MemoryLayout<Float>.size

    for buffer in buffers {
        if Int(buffer.mDataByteSize) < expectedBytes {
            context.invalidPlaybackBufferCount.wrappingAdd(
                1,
                ordering: .relaxed
            )

            return kAudio_ParamError
        }
    }

    if context.speechSamples.isEmpty {
        guard buffers.count == 1, buffers[0].mNumberChannels == 1,
              let data = buffers[0].mData else { return kAudio_ParamError }
        renderNativePlayback(context: context,
                             into: data.assumingMemoryBound(to: Float.self),
                             frames: Int(inNumberFrames))
        return noErr
    }

    let startingIndex = context.speechPlaybackIndex
    let frameCount = Int(inNumberFrames)

    for buffer in buffers {
        guard let data = buffer.mData else {
            return kAudio_ParamError
        }

        let outputSamples = data.assumingMemoryBound(to: Float.self)

        for frame in 0..<frameCount {
            let sampleIndex = startingIndex + frame

            if sampleIndex < context.speechSamples.count {
                outputSamples[frame] = context.speechSamples[sampleIndex]
            } else {
                outputSamples[frame] = 0.0
            }
        }
    }

    context.speechPlaybackIndex = min(
        startingIndex + frameCount,
        context.speechSamples.count
    )

    return noErr
}

if CommandLine.arguments.contains("--test-streaming-buffer") {
    let capacity = 8
    let buffer = UnsafeMutablePointer<Float>.allocate(capacity: capacity)
    buffer.initialize(repeating: -1, count: capacity)
    let write = Atomic<Int>(0)
    let read = Atomic<Int>(0)
    let dropped = Atomic<UInt64>(0)

    func produce(_ values: [Float]) {
        values.withUnsafeBufferPointer { input in
            writeStreamingSamples(
                samples: input.baseAddress!, frameCount: input.count,
                buffer: buffer, capacity: capacity,
                writePositionAtomic: write, readPositionAtomic: read,
                droppedFramesAtomic: dropped
            )
        }
    }

    func unreadSamples() -> [Float] {
        let end = write.load(ordering: .acquiring)
        var index = read.load(ordering: .relaxed)
        var values: [Float] = []
        while index != end {
            values.append(buffer[index])
            index = (index + 1) % capacity
        }
        return values
    }

    produce([0, 1, 2, 3, 4, 5])
    precondition(unreadSamples() == [0, 1, 2, 3, 4, 5], "Initial sample order")
    let consumed = UnsafeMutablePointer<Float>.allocate(capacity: capacity)
    consumed.initialize(repeating: 0, count: capacity)
    let consumedCount = readStreamingSamples(
        into: consumed, maxFrames: 4, buffer: buffer, capacity: capacity,
        writePosition: write, readPosition: read
    )
    precondition(consumedCount == 4 && Array(UnsafeBufferPointer(start: consumed, count: 4)) == [0, 1, 2, 3],
                 "Consumer must copy before publishing its position")
    produce([6, 7, 8, 9, 10, 11])
    precondition(write.load(ordering: .acquiring) == 3, "Write position must wrap")
    precondition(unreadSamples() == [4, 5, 6, 7, 8, 9, 10], "Wraparound sample order")
    precondition(dropped.load(ordering: .relaxed) == 1, "Partial overflow count")
    produce([12, 13])
    precondition(unreadSamples() == [4, 5, 6, 7, 8, 9, 10], "Full buffer must preserve unread samples")
    precondition(dropped.load(ordering: .relaxed) == 3, "Full buffer drop count")
    let drainedCount = readStreamingSamples(
        into: consumed, maxFrames: capacity, buffer: buffer, capacity: capacity,
        writePosition: write, readPosition: read
    )
    precondition(drainedCount == 7 && Array(UnsafeBufferPointer(start: consumed, count: 7)) == [4, 5, 6, 7, 8, 9, 10],
                 "Consumer must preserve sample order across wraparound")
    consumed.deinitialize(count: capacity)
    consumed.deallocate()
    precondition(unreadSamples().isEmpty, "Buffer must be empty after drain")
    produce([14, 15])
    precondition(unreadSamples() == [14, 15], "Reuse after drain")

    buffer.deinitialize(count: capacity)
    buffer.deallocate()
    diagnostic("Streaming buffer self-test passed: wraparound, ordering, overflow, and reuse.")
    exit(0)
}

func readStreamingSamples(
    into destination: UnsafeMutablePointer<Float>, maxFrames: Int,
    buffer: UnsafeMutablePointer<Float>, capacity: Int,
    writePosition: borrowing Atomic<Int>, readPosition: borrowing Atomic<Int>
) -> Int {
    let read = readPosition.load(ordering: .relaxed)
    let write = writePosition.load(ordering: .acquiring)
    let count = min(maxFrames, (write - read + capacity) % capacity)
    guard count > 0 else { return 0 }
    let first = min(count, capacity - read)
    destination.update(from: buffer.advanced(by: read), count: first)
    if count > first {
        destination.advanced(by: first).update(from: buffer, count: count - first)
    }

    readPosition.store((read + count) % capacity, ordering: .releasing)
    return count
}

final class PCMStreamConverter {
    let converter: AVAudioConverter
    let input: AVAudioPCMBuffer
    let output: AVAudioPCMBuffer

    init() throws {
        guard let source = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                        sampleRate: 44100, channels: 1, interleaved: false),
              let target = AVAudioFormat(commonFormat: .pcmFormatInt16,
                                        sampleRate: 16000, channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: source, to: target),
              let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: 4096),
              let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: 1024) else {
            throw audioError("Could not allocate streaming converter")
        }
        self.converter = converter
        self.input = input
        self.output = output
    }

    func pump(context: AudioCaptureContext, finishing: Bool = false,
              emit: (Data) throws -> Void) throws -> AVAudioConverterOutputStatus {
        output.frameLength = 0
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { requested, state in
            let count = readStreamingSamples(
                into: self.input.floatChannelData![0],
                maxFrames: min(Int(requested), Int(self.input.frameCapacity)),
                buffer: context.streamingBuffer, capacity: context.streamingCapacity,
                writePosition: context.streamingWritePosition,
                readPosition: context.streamingReadPosition
            )
            guard count > 0 else {
                state.pointee = finishing ? .endOfStream : .noDataNow
                return nil
            }
            self.input.frameLength = AVAudioFrameCount(count)
            state.pointee = .haveData
            return self.input
        }
        if let error { throw error }
        if status == .error { throw audioError("Streaming conversion failed") }
        if output.frameLength > 0 {

            try emit(Data(bytes: output.int16ChannelData![0],
                          count: Int(output.frameLength) * MemoryLayout<Int16>.size))
        }
        return status
    }
}

final class ShutdownFlag: @unchecked Sendable {
    let requested = Atomic<Bool>(false)
}

func writePCM(_ data: Data, shutdown: ShutdownFlag) throws {
    try data.withUnsafeBytes { bytes in
        var offset = 0
        while offset < bytes.count {
            if shutdown.requested.load(ordering: .relaxed) { return }
            var descriptor = pollfd(fd: STDOUT_FILENO, events: Int16(POLLOUT), revents: 0)
            let ready = poll(&descriptor, 1, 100)
            if ready < 0 {
                if errno == EINTR { continue }
                throw audioError("stdout poll failed: \(errno)")
            }
            if ready == 0 { continue }
            let count = Darwin.write(STDOUT_FILENO, bytes.baseAddress!.advanced(by: offset), bytes.count - offset)
            if count > 0 { offset += count }
            else if count < 0 && (errno == EINTR || errno == EAGAIN) { continue }
            else { throw audioError("stdout closed or write failed: \(errno)") }
        }
    }
}

final class NativePlaybackReceiver: @unchecked Sendable {
    let context: AudioCaptureContext
    let emit: ([String: Any]) -> Void
    var line = Data()
    var discardingLine = false
    var activeID: UInt64?
    var latestID: UInt64 = 0

    init(context: AudioCaptureContext, emit: @escaping ([String: Any]) -> Void) {
        self.context = context
        self.emit = emit
    }

    func report(_ type: String, id: UInt64, message: String? = nil) {
        var event: [String: Any] = ["type": type, "id": id]
        if let message { event["message"] = String(message.prefix(1000)) }
        emit(event)
    }

    func collectCompletion() {
        guard let id = activeID else { return }
        let state = context.playbackState.load(ordering: .acquiring)
        guard state == 2 || state == 3 else { return }
        activeID = nil
        context.playbackState.store(0, ordering: .releasing)
        report(state == 2 ? "playbackFinished" : "playbackStopped", id: id)
    }

    func receive(_ bytes: Data) {
        for byte in bytes {
            if byte == 10 {
                if !discardingLine && !line.isEmpty { handleLine(line) }
                line.removeAll(keepingCapacity: true)
                discardingLine = false
            } else if !discardingLine {
                if line.count < 8192 { line.append(byte) }
                else {
                    line.removeAll(keepingCapacity: true)
                    discardingLine = true
                    diagnostic("Ignoring oversized native playback command")
                }
            }
        }
    }

    func handleLine(_ data: Data) {
        collectCompletion()
        guard let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let number = value["id"] as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
              number.doubleValue > 0, number.doubleValue <= 9007199254740991,
              let type = value["type"] as? String else {
            diagnostic("Ignoring malformed native playback command")
            return
        }
        let id = number.uint64Value
        if type == "stop" {
            if activeID == id {
                context.playbackStopID.store(id, ordering: .releasing)
            } else {

                report("playbackStopped", id: id)
            }
            return
        }
        guard type == "play", let path = value["path"] as? String,
              path.hasPrefix("/"), !path.utf8.contains(0) else {
            report("playbackError", id: id, message: "Expected play with an absolute audio file path, or stop")
            return
        }
        guard id > latestID else {

            diagnostic("Ignoring reused native playback ID \(id)")
            return
        }
        latestID = id
        guard activeID == nil else {
            report("playbackError", id: id, message: "Native playback is busy")
            return
        }
        do {
            let samples = try loadSpeechSamples(from: path)
            samples.withUnsafeBufferPointer {
                context.playbackBuffer.update(from: $0.baseAddress!, count: $0.count)
            }
            context.playbackRequestID = id
            context.playbackSampleCount = samples.count
            context.playbackStopID.store(0, ordering: .relaxed)
            activeID = id

            context.playbackState.store(1, ordering: .releasing)
        } catch {
            report("playbackError", id: id, message: error.localizedDescription)
        }
    }

    func run(shutdown: ShutdownFlag) {
        var bytes = [UInt8](repeating: 0, count: 4096)
        while !shutdown.requested.load(ordering: .relaxed) {
            collectCompletion()
            var descriptor = pollfd(fd: STDIN_FILENO, events: Int16(POLLIN), revents: 0)
            let ready = poll(&descriptor, 1, 10)
            if ready < 0 {
                if errno == EINTR { continue }
                diagnostic("Native command input poll failed")
                shutdown.requested.store(true, ordering: .relaxed)
                return
            }
            if ready == 0 { continue }
            let count = Darwin.read(STDIN_FILENO, &bytes, bytes.count)
            if count > 0 { receive(Data(bytes.prefix(count))) }
            else if count == 0 {

                shutdown.requested.store(true, ordering: .relaxed)
            } else if errno != EINTR && errno != EAGAIN {
                diagnostic("Native command input read failed")
                shutdown.requested.store(true, ordering: .relaxed)
            }
        }
        collectCompletion()
    }
}

func checkStatus(_ status: OSStatus, _ operation: String) throws {
    guard status == noErr else { throw audioError("\(operation): OSStatus \(status)") }
}

func runAudio(recordingTest: Bool) throws {
    let shutdown = ShutdownFlag()
    signal(SIGINT, SIG_IGN)
    signal(SIGTERM, SIG_IGN)
    signal(SIGPIPE, SIG_IGN)
    let signals = [SIGINT, SIGTERM].map { number -> DispatchSourceSignal in
        let source = DispatchSource.makeSignalSource(signal: number, queue: .global())
        source.setEventHandler { shutdown.requested.store(true, ordering: .relaxed) }
        source.resume()
        return source
    }
    defer { signals.forEach { $0.cancel() } }

    let stdoutFlags = fcntl(STDOUT_FILENO, F_GETFL)
    if !recordingTest {
        guard isatty(STDOUT_FILENO) == 0 else {
            throw audioError("Redirect stdout to a PCM file or pipe before streaming. Use --recording-test for the six-second playback test.")
        }
        guard stdoutFlags >= 0, fcntl(STDOUT_FILENO, F_SETFL, stdoutFlags | O_NONBLOCK) == 0 else {
            throw audioError("Could not configure stdout")
        }
    }
    defer {
        if !recordingTest && stdoutFlags >= 0 { _ = fcntl(STDOUT_FILENO, F_SETFL, stdoutFlags) }
    }

    var description = AudioComponentDescription()
    description.componentType = kAudioUnitType_Output
    description.componentSubType = voiceProcessingType
    description.componentManufacturer = kAudioUnitManufacturer_Apple
    guard let component = AudioComponentFindNext(nil, &description) else {
        throw audioError("VoiceProcessingIO component not found")
    }
    var optionalUnit: AudioUnit?
    try checkStatus(AudioComponentInstanceNew(component, &optionalUnit), "Create Audio Unit")
    guard let unit = optionalUnit else { throw audioError("Audio Unit is nil") }
    defer { AudioComponentInstanceDispose(unit) }

    var enabled: UInt32 = 1
    for (scope, bus) in [(kAudioUnitScope_Input, UInt32(1)), (kAudioUnitScope_Output, UInt32(0))] {
        try checkStatus(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_EnableIO, scope, bus,
                                            &enabled, UInt32(MemoryLayout<UInt32>.size)), "Enable audio I/O")
    }
    var format = AudioStreamBasicDescription(
        mSampleRate: 44100, mFormatID: kAudioFormatLinearPCM,
        mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
        mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4,
        mChannelsPerFrame: 1, mBitsPerChannel: 32, mReserved: 0
    )
    for (scope, bus) in [(kAudioUnitScope_Output, UInt32(1)), (kAudioUnitScope_Input, UInt32(0))] {
        try checkStatus(AudioUnitSetProperty(unit, kAudioUnitProperty_StreamFormat, scope, bus,
                                            &format, UInt32(MemoryLayout<AudioStreamBasicDescription>.size)), "Set stream format")
    }
    let speech = recordingTest
        ? try loadSpeechSamples(from: "native/audio/samples/jarvis-test.wav") : []
    let context = AudioCaptureContext(audioUnit: unit, speechSamples: speech)

    let retainedContext = Unmanaged.passRetained(context)
    defer { retainedContext.release() }
    var capture = AURenderCallbackStruct(inputProc: microphoneCallback, inputProcRefCon: retainedContext.toOpaque())
    var playback = AURenderCallbackStruct(inputProc: speakerPlaybackCallback, inputProcRefCon: retainedContext.toOpaque())
    try checkStatus(AudioUnitSetProperty(unit, kAudioOutputUnitProperty_SetInputCallback,
                                        kAudioUnitScope_Global, 1, &capture,
                                        UInt32(MemoryLayout<AURenderCallbackStruct>.size)), "Set capture callback")
    try checkStatus(AudioUnitSetProperty(unit, kAudioUnitProperty_SetRenderCallback,
                                        kAudioUnitScope_Input, 0, &playback,
                                        UInt32(MemoryLayout<AURenderCallbackStruct>.size)), "Set playback callback")
    var bypass: UInt32 = 0
    try checkStatus(AudioUnitSetProperty(unit, kAUVoiceIOProperty_BypassVoiceProcessing,
                                        kAudioUnitScope_Global, 0, &bypass,
                                        UInt32(MemoryLayout<UInt32>.size)), "Enable voice processing")
    try checkStatus(AudioUnitInitialize(unit), "Initialize Audio Unit")
    defer { AudioUnitUninitialize(unit) }
    var maximumFrames: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    try checkStatus(AudioUnitGetProperty(unit, kAudioUnitProperty_MaximumFramesPerSlice,
                                        kAudioUnitScope_Global, 0, &maximumFrames, &size), "Get maximum callback size")
    guard maximumFrames <= context.maxFrames else { throw audioError("Callback exceeds allocated capture buffer") }
    let converter = try PCMStreamConverter()
    try checkStatus(AudioOutputUnitStart(unit), "Start Audio Unit")
    var started = true
    defer { if started { AudioOutputUnitStop(unit) } }
    let playbackWorker = DispatchGroup()
    if !recordingTest {
        let receiver = NativePlaybackReceiver(context: context) { event in
            if let data = try? JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]),
               let text = String(data: data, encoding: .utf8) {
                diagnostic(text)
            }
        }
        playbackWorker.enter()
        DispatchQueue(label: "jarvis.native-playback").async {
            defer { playbackWorker.leave() }
            receiver.run(shutdown: shutdown)
        }
    }
    defer {
        shutdown.requested.store(true, ordering: .relaxed)
        playbackWorker.wait()
    }
    diagnostic("Voice processing enabled. Mode: \(recordingTest ? "recording test" : "PCM streaming"). Maximum frames: \(maximumFrames)")
    let deadline = Date().addingTimeInterval(6)
    while !shutdown.requested.load(ordering: .relaxed) {
        if recordingTest {
            if Date() >= deadline { break }
            Thread.sleep(forTimeInterval: 0.01)
        } else {
            let status = try converter.pump(context: context) { try writePCM($0, shutdown: shutdown) }
            if status == .inputRanDry { Thread.sleep(forTimeInterval: 0.005) }
        }
    }
    try checkStatus(AudioOutputUnitStop(unit), "Stop Audio Unit")
    started = false

    if recordingTest {
        try saveMicrophoneRecording(context: context, to: "native/audio/samples/microphone-test.wav")
        let converted = try convertMicrophoneAudio(context: context)
        try saveConvertedPCM(buffer: converted, to: "native/audio/samples/microphone-test.pcm")
        diagnostic("Converted audio frames: \(converted.frameLength)")
        diagnostic("Recording and converted PCM saved under native/audio/samples/")
    }
    let recorded = context.recordedFrameCount.load(ordering: .relaxed)
    diagnostic("Recorded microphone frames: \(recorded)")
    diagnostic("Recorded audio duration: \(Double(recorded) / 44100) seconds (fixed recording buffer)")
    let total = context.totalSampleCount.load(ordering: .relaxed)
    let read = context.streamingReadPosition.load(ordering: .relaxed)
    let write = context.streamingWritePosition.load(ordering: .acquiring)
    diagnostic("Captured frames: \(total)")
    diagnostic("Streaming buffered frames: \((write - read + context.streamingCapacity) % context.streamingCapacity)")
    diagnostic("Streaming dropped frames: \(context.streamingDroppedFrames.load(ordering: .relaxed))")
    diagnostic("Speech detection callbacks: \(context.speechDetectedCount.load(ordering: .relaxed))")
    diagnostic("Peak microphone amplitude: \(Float(bitPattern: context.peakAmplitudeBits.load(ordering: .relaxed)))")
    if total > 0 {
        let energy = Double(bitPattern: context.totalSumOfSquaresBits.load(ordering: .relaxed))
        diagnostic("Overall recording RMS: \(sqrt(energy / Double(total)))")
    }
    diagnostic("Invalid speaker playback buffers: \(context.invalidPlaybackBufferCount.load(ordering: .relaxed))")
}

func testNativePlayback() throws {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("jarvis-playback-\(UUID().uuidString).wav")
    defer { try? FileManager.default.removeItem(at: url) }

    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000,
                               channels: 2, interleaved: false)!
    let diskFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 24000,
                                   channels: 2, interleaved: true)!
    let fixture = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 2400)!
    fixture.frameLength = 2400
    for channel in 0..<2 {
        for index in 0..<2400 {
            fixture.floatChannelData![channel][index] = Float(sin(Double(index) * 2 * .pi * 440 / 24000) * 0.2)
        }
    }
    do {
        let file = try AVAudioFile(forWriting: url, settings: diskFormat.settings,
                                   commonFormat: .pcmFormatFloat32, interleaved: false)
        try file.write(from: fixture)
    }
    let converted = try loadSpeechSamples(from: url.path)
    precondition(abs(converted.count - 4410) < 32, "Playback conversion must preserve duration")
    precondition(converted.contains { abs($0) > 0.05 }, "Playback conversion must preserve signal")
    let context = AudioCaptureContext(audioUnit: nil, speechSamples: [])
    var events: [[String: Any]] = []
    let receiver = NativePlaybackReceiver(context: context) { events.append($0) }
    func command(_ type: String, _ id: Int, path: String? = nil) throws -> Data {
        var value: [String: Any] = ["type": type, "id": id]
        if let path { value["path"] = path }
        var data = try JSONSerialization.data(withJSONObject: value)
        data.append(10)
        return data
    }
    func saw(_ type: String, _ id: Int) -> Bool {
        events.contains { $0["type"] as? String == type && ($0["id"] as? NSNumber)?.intValue == id }
    }
    let output = UnsafeMutablePointer<Float>.allocate(capacity: 128)
    output.initialize(repeating: 0, count: 128)
    defer { output.deinitialize(count: 128); output.deallocate() }
    let first = try command("play", 1, path: url.path)
    receiver.receive(first.prefix(7))
    precondition(context.playbackState.load(ordering: .acquiring) == 0, "Partial line must not execute")
    receiver.receive(first.dropFirst(7))
    precondition(context.playbackState.load(ordering: .acquiring) == 1, "Complete line must publish playback")
    var rendered: [Float] = []
    for _ in 0..<100 {
        renderNativePlayback(context: context, into: output, frames: 128)
        rendered.append(contentsOf: UnsafeBufferPointer(start: output, count: 128))
        if context.playbackState.load(ordering: .acquiring) == 2 { break }
    }
    precondition(Array(rendered.prefix(converted.count)) == converted, "Playback must preserve sample order")
    precondition(rendered.dropFirst(converted.count).allSatisfy { $0 == 0 }, "Tail must be silent")
    receiver.collectCompletion()
    precondition(saw("playbackFinished", 1), "Rendered speech must report completion")
    let eventCount = events.count
    receiver.collectCompletion()
    precondition(events.count == eventCount, "Completion must only be emitted once")

    var commands = try command("play", 2, path: url.path)
    commands.append(try command("play", 3, path: url.path))
    commands.append(try command("stop", 1))
    receiver.receive(commands)
    renderNativePlayback(context: context, into: output, frames: 128)
    precondition(context.playbackState.load(ordering: .acquiring) == 1, "Stale stop must not cancel current speech")
    precondition(saw("playbackError", 3), "Concurrent play must be rejected")
    receiver.receive(try command("stop", 2))
    renderNativePlayback(context: context, into: output, frames: 128)
    precondition(UnsafeBufferPointer(start: output, count: 128).allSatisfy { $0 == 0 }, "Stop must output silence")
    receiver.collectCompletion()
    precondition(saw("playbackStopped", 2), "Stop must be acknowledged")
    receiver.receive(try command("play", 4, path: url.path + ".missing"))
    precondition(saw("playbackError", 4), "Missing file must report a request error")
    receiver.receive(Data("not JSON\n".utf8))
    receiver.receive(Data(repeating: 65, count: 9000))
    receiver.receive(Data([10]))
    receiver.receive(try command("play", 5, path: url.path))
    receiver.receive(try command("stop", 5))
    renderNativePlayback(context: context, into: output, frames: 128)
    receiver.collectCompletion()
    precondition(saw("playbackStopped", 5), "Receiver must recover after malformed input")
    diagnostic("Playback self-test passed: PCM16/stereo resampling, framing, rendering, completion, busy rejection, stop, stale IDs, and malformed-input recovery.")
}

let options = Array(CommandLine.arguments.dropFirst())
if options == ["--help"] {
    diagnostic("Usage: swift native/audio/main.swift [--recording-test | --test-streaming-buffer | --test-converter | --test-playback]")
    diagnostic("Default: continuous 16 kHz mono Int16 LE PCM on stdout; diagnostics on stderr. Stop with SIGINT/SIGTERM.")
    diagnostic("--recording-test: six-second capture with prerecorded speech and offline recording files.")
    exit(0)
}
if options == ["--test-playback"] {
    do {
        try testNativePlayback()
        exit(0)
    } catch {
        diagnostic("Playback self-test failed: \(error)")
        exit(1)
    }
}
if options == ["--test-converter"] {
    do {

        let context = AudioCaptureContext(audioUnit: nil, speechSamples: [])
        let converter = try PCMStreamConverter()
        var bytes = 0
        var energy: Double = 0
        let sink: (Data) -> Void = { data in
            bytes += data.count
            data.withUnsafeBytes { raw in
                for sample in raw.bindMemory(to: Int16.self) {
                    energy += Double(sample) * Double(sample)
                }
            }
        }

        var offset = 0
        while offset < 132300 {
            let count = min(733, 132300 - offset)
            let samples = (0..<count).map { Float(sin(2 * Double.pi * 440 * Double(offset + $0) / 44100) * 0.25) }
            samples.withUnsafeBufferPointer {
                writeStreamingSamples(samples: $0.baseAddress!, frameCount: count,
                    buffer: context.streamingBuffer, capacity: context.streamingCapacity,
                    writePositionAtomic: context.streamingWritePosition,
                    readPositionAtomic: context.streamingReadPosition,
                    droppedFramesAtomic: context.streamingDroppedFrames)
            }
            _ = try converter.pump(context: context, emit: sink)
            offset += count
        }
        var finished = false
        for _ in 0..<100 {
            if try converter.pump(context: context, finishing: true, emit: sink) == .endOfStream {
                finished = true
                break
            }
        }
        precondition(finished, "Converter must finish")
        precondition(abs(bytes / 2 - 48000) < 32, "Converted duration must be approximately three seconds")
        precondition(energy > 0, "Converted signal must not be silent")
        precondition(context.streamingDroppedFrames.load(ordering: .relaxed) == 0, "Unexpected drops")
        diagnostic("Converter self-test passed: \(bytes / 2) Int16 samples, nonzero signal, no drops.")
        exit(0)
    } catch {
        diagnostic("Converter self-test failed: \(error)")
        exit(1)
    }
}
guard options.isEmpty || options == ["--recording-test"] else {
    diagnostic("Unknown arguments. Use --help.")
    exit(1)
}
do {
    try runAudio(recordingTest: options == ["--recording-test"])
} catch {
    diagnostic("Native audio failed: \(error)")
    exit(1)
}
