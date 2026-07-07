#import <AVFoundation/AVFoundation.h>
#import <vector>
#import <string>

/// Hybrid audio processor — mixes Objective-C with C++ for audio DSP.
/// Handles audio buffer processing with SIMD optimizations via Accelerate
/// framework and raw C++ vector operations.
@interface AudioProcessor : NSObject {
@public
    std::vector<float> _sampleBuffer;
}

@property (nonatomic, assign) float gain;
@property (nonatomic, assign, readonly) NSUInteger sampleCount;
@property (nonatomic, strong) AVAudioEngine *audioEngine;

+ (instancetype)processorWithSampleRate:(double)sampleRate;

- (void)processBuffer:(AVAudioPCMBuffer *)buffer;
- (std::vector<float>)extractSamplesFromBuffer:(AVAudioPCMBuffer *)buffer;
- (void)applyGainToSamples:(std::vector<float> &)samples;

@end
