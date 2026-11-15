using Xunit;

namespace PDFreader.Tests;

/// <summary>
/// Tests that touch Persistence.RootOverride (a static!) must never run
/// concurrently with each other — parallel classes flipping the static made
/// SaveRecent/LoadRecent race to different roots and fail intermittently
/// (caught by CI on the perf commit). All such classes join this collection.
/// </summary>
[CollectionDefinition("PersistenceRoot", DisableParallelization = true)]
public partial class PersistenceRootCollection { }
