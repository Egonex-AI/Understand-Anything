#import <UIKit/UIKit.h>

/// Root view controller — manages the main table view and coordinates between
/// the data service and the UI layer. This is the first screen users see.
@interface MainViewController : UIViewController <UITableViewDataSource, UITableViewDelegate>

@property (nonatomic, strong) UITableView *tableView;
@property (nonatomic, strong) UIRefreshControl *refreshControl;
@property (nonatomic, strong) NSArray *displayItems;

- (instancetype)initWithDataService:(DataService *)service;
- (void)refreshData;

@end
