#import "AudioProcessor.h"
#import <Accelerate/Accelerate.h>
#import <algorithm>

@implementation AudioProcessor

+ (instancetype)processorWithSampleRate:(double)sampleRate {
    AudioProcessor *processor = [[AudioProcessor alloc] init];
    processor.audioEngine = [[AVAudioEngine alloc] init];
    processor.gain = 1.0f;
    return processor;
}

- (std::vector<float>)extractSamplesFromBuffer:(AVAudioPCMBuffer *)buffer {
    std::vector<float> samples;
    AVAudioFrameCount frameCount = buffer.frameLength;

    if (frameCount == 0) return samples;

    samples.resize(frameCount);
    float *channelData = buffer.floatChannelData[0];
    memcpy(samples.data(), channelData, frameCount * sizeof(float));

    return samples;
}

- (void)applyGainToSamples:(std::vector<float> &)samples {
    float scalar = self.gain;
    vDSP_vsmul(samples.data(), 1, &scalar, samples.data(), 1, samples.size());
}

- (void)processBuffer:(AVAudioPCMBuffer *)buffer {
    auto samples = [self extractSamplesFromBuffer:buffer];
    [self applyGainToSamples:samples];

    // C++ algorithm: clamp to [-1.0, 1.0]
    std::transform(samples.begin(), samples.end(), samples.begin(), [](float s) {
        return std::max(-1.0f, std::min(1.0f, s));
    });

    NSUInteger count = samples.size();
    _sampleBuffer = std::move(samples);
    _sampleCount = count;

    NSLog(@"Processed %lu samples with gain %.2f", (unsigned long)count, self.gain);
}

- (NSUInteger)sampleCount {
    return _sampleBuffer.size();
}

@end
