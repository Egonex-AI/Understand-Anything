#import "MainViewController.h"
#import "DataService.h"
#import "ItemCell.h"

@implementation MainViewController {
    DataService *_dataService;
}

- (instancetype)initWithDataService:(DataService *)service {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        _dataService = service;
        self.title = @"Items";
        self.displayItems = @[];
    }
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];

    [self setupTableView];
    [self refreshData];
}

- (void)setupTableView {
    self.tableView = [[UITableView alloc] initWithFrame:self.view.bounds style:UITableViewStylePlain];
    self.tableView.dataSource = self;
    self.tableView.delegate = self;
    self.tableView.rowHeight = UITableViewAutomaticDimension;
    self.tableView.estimatedRowHeight = 80;
    [self.tableView registerClass:[ItemCell class] forCellReuseIdentifier:@"ItemCell"];
    [self.view addSubview:self.tableView];

    self.refreshControl = [[UIRefreshControl alloc] init];
    [self.refreshControl addTarget:self
                            action:@selector(refreshData)
                  forControlEvents:UIControlEventValueChanged];
    self.tableView.refreshControl = self.refreshControl;
}

#pragma mark - Data

- (void)refreshData {
    [self.refreshControl beginRefreshing];
    [_dataService fetchItemsWithCompletion:^(NSArray *items, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self.refreshControl endRefreshing];
            if (error) {
                [self showError:error];
                return;
            }
            self.displayItems = items;
            [self.tableView reloadData];
        });
    }];
}

- (void)showError:(NSError *)error {
    UIAlertController *alert = [UIAlertController
        alertControllerWithTitle:@"Error"
                         message:error.localizedDescription
                  preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

#pragma mark - UITableViewDataSource

- (NSInteger)tableView:(UITableView *)tableView numberOfRowsInSection:(NSInteger)section {
    return self.displayItems.count;
}

- (UITableViewCell *)tableView:(UITableView *)tableView cellForRowAtIndexPath:(NSIndexPath *)indexPath {
    ItemCell *cell = [tableView dequeueReusableCellWithIdentifier:@"ItemCell" forIndexPath:indexPath];
    NSDictionary *item = self.displayItems[indexPath.row];
    [cell configureWithItem:item];
    return cell;
}

#pragma mark - UITableViewDelegate

- (void)tableView:(UITableView *)tableView didSelectRowAtIndexPath:(NSIndexPath *)indexPath {
    [tableView deselectRowAtIndexPath:indexPath animated:YES];

    NSDictionary *item = self.displayItems[indexPath.row];
    NSString *itemID = item[@"id"];

    [_dataService fetchItemWithID:itemID completion:^(id detail, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (error) {
                [self showError:error];
                return;
            }
            // Navigate to detail view
            [self showDetailForItem:detail];
        });
    }];
}

- (void)showDetailForItem:(id)item {
    NSLog(@"Showing detail for: %@", item);
}

@end
