#import "DataService.h"
#import "CacheManager.h"
#import "NetworkClient.h"

@interface DataService ()

@property (nonatomic, strong) CacheManager *cacheManager;
@property (nonatomic, strong) NetworkClient *networkClient;
@property (nonatomic, strong) dispatch_queue_t workQueue;

@end

@implementation DataService

+ (instancetype)sharedService {
    static DataService *instance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        instance = [[DataService alloc] initWithConfiguration:nil];
    });
    return instance;
}

- (instancetype)initWithConfiguration:(NSDictionary *)config {
    self = [super init];
    if (self) {
        _workQueue = dispatch_queue_create("com.example.dataservice", DISPATCH_QUEUE_CONCURRENT);
        _networkClient = [[NetworkClient alloc] init];
        _cacheManager = [[CacheManager alloc] init];
        _isOnline = YES;

        [self setupNotifications];
    }
    return self;
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

#pragma mark - Setup

- (void)setupNotifications {
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(reachabilityChanged:)
                                                 name:kReachabilityChangedNotification
                                               object:nil];
}

- (void)reachabilityChanged:(NSNotification *)notification {
    BOOL reachable = [notification.userInfo[@"reachable"] boolValue];
    self.isOnline = reachable;
    if (!reachable) {
        [self handleOfflineTransition];
    } else {
        [self.delegate dataServiceDidConnect:self];
    }
}

#pragma mark - Data Fetching

- (void)fetchItemsWithCompletion:(void (^)(NSArray *items, NSError *error))completion {
    if (!self.isOnline) {
        NSArray *cached = [self.cacheManager cachedItems];
        if (cached) {
            completion(cached, nil);
            return;
        }
    }

    [self.networkClient GET:@"/api/items" parameters:nil completion:^(id response, NSError *error) {
        if (error) {
            [self.delegate dataService:self didFailWithError:error];
            completion(nil, error);
            return;
        }

        NSArray *items = response[@"data"];
        [self.cacheManager cacheItems:items];

        dispatch_async(dispatch_get_main_queue(), ^{
            completion(items, nil);
        });
    }];
}

- (void)fetchItemWithID:(NSString *)itemID completion:(void (^)(id item, NSError *error))completion {
    NSString *cacheKey = [NSString stringWithFormat:@"item_%@", itemID];
    id cached = [self.cacheManager objectForKey:cacheKey];
    if (cached) {
        completion(cached, nil);
        return;
    }

    NSString *endpoint = [NSString stringWithFormat:@"/api/items/%@", itemID];
    [self.networkClient GET:endpoint parameters:nil completion:^(id response, NSError *error) {
        if (error) {
            completion(nil, error);
            return;
        }
        id item = response[@"data"];
        [self.cacheManager setObject:item forKey:cacheKey];
        completion(item, nil);
    }];
}

#pragma mark - Filtering & Processing

- (NSArray *)filterItems:(NSArray *)rawItems
             withCriteria:(NSDictionary *)criteria
                 sortedBy:(NSString *)sortKey {
    NSPredicate *predicate = [self predicateFromCriteria:criteria];
    NSArray *filtered = [rawItems filteredArrayUsingPredicate:predicate];

    if (sortKey) {
        NSSortDescriptor *descriptor = [NSSortDescriptor sortDescriptorWithKey:sortKey ascending:YES];
        filtered = [filtered sortedArrayUsingDescriptors:@[descriptor]];
    }

    return filtered;
}

- (NSPredicate *)predicateFromCriteria:(NSDictionary *)criteria {
    NSMutableArray *subpredicates = [NSMutableArray array];
    [criteria enumerateKeysAndObjectsUsingBlock:^(NSString *key, id value, BOOL *stop) {
        NSPredicate *sub = [NSPredicate predicateWithFormat:@"%K == %@", key, value];
        [subpredicates addObject:sub];
    }];
    return [NSCompoundPredicate andPredicateWithSubpredicates:subpredicates];
}

#pragma mark - Batch Operations

- (void)batchUpdateItems:(NSArray *)items
             withHandler:(void (^)(BOOL success, NSInteger updatedCount))handler {
    dispatch_barrier_async(self.workQueue, ^{
        NSInteger count = 0;
        BOOL allSuccess = YES;

        for (NSDictionary *item in items) {
            NSString *itemID = item[@"id"];
            BOOL ok = [self updateSingleItem:itemID withData:item];
            if (ok) {
                count++;
            } else {
                allSuccess = NO;
            }
        }

        dispatch_async(dispatch_get_main_queue(), ^{
            handler(allSuccess, count);
        });

        if (count > 0) {
            [self.delegate dataServiceDidConnect:self]; // notify after batch
        }
    });
}

- (BOOL)updateSingleItem:(NSString *)itemID withData:(NSDictionary *)data {
    [self.cacheManager invalidateKey:[NSString stringWithFormat:@"item_%@", itemID]];
    return YES;
}

#pragma mark - Offline Handling

- (void)handleOfflineTransition {
    [self.cacheManager persistToDisk];
    if ([self.delegate respondsToSelector:@selector(dataServiceDidGoOffline:)]) {
        [self.delegate dataServiceDidGoOffline:self];
    }
}

#pragma mark - Singleton Reset (Testing)

- (void)resetService {
    [self.cacheManager clearAll];
    self.isOnline = YES;
}

@end
