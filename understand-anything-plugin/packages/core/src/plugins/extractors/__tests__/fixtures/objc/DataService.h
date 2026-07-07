#import <Foundation/Foundation.h>

/// Core data service — handles network requests, caching, and data pipelines
/// for the entire application. This is the primary entry point for all data
/// operations.
@protocol DataServiceDelegate;

@interface DataService : NSObject

@property (nonatomic, strong, readonly) NSURLSession *session;
@property (nonatomic, assign) BOOL isOnline;
@property (nonatomic, weak) id<DataServiceDelegate> delegate;

// Lifecycle
- (instancetype)initWithConfiguration:(NSDictionary *)config;
+ (instancetype)sharedService;

// Data fetching
- (void)fetchItemsWithCompletion:(void (^)(NSArray *items, NSError *error))completion;
- (void)fetchItemWithID:(NSString *)itemID completion:(void (^)(id item, NSError *error))completion;

// Multi-part selector
- (NSArray *)filterItems:(NSArray *)rawItems
             withCriteria:(NSDictionary *)criteria
                 sortedBy:(NSString *)sortKey;

// Batch operations
- (void)batchUpdateItems:(NSArray *)items
             withHandler:(void (^)(BOOL success, NSInteger updatedCount))handler;

@end

@protocol DataServiceDelegate <NSObject>

@required
- (void)dataServiceDidConnect:(DataService *)service;
- (void)dataService:(DataService *)service didFailWithError:(NSError *)error;

@optional
- (void)dataServiceDidGoOffline:(DataService *)service;

@end
