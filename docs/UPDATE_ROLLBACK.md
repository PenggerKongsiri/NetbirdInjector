# Update and rollback

Updates accept only an extracted runtime release containing `RELEASE_MANIFEST.json`. Verify both the archive checksum and the internal manifest before elevation:

```bash
sha256sum -c SHA256SUMS
tar -xzf netbird-injector-manager-v<VERSION>.tar.gz
cd netbird-injector-manager
node scripts/release.mjs verify .
sudo ./setup update
sudo ./setup status
```

Update creates a consistent backup, installs an immutable timestamped release, atomically changes the current symlink, reloads the unit, restarts, and polls health. Unit-install, restart, or health failure reinstates the previous code and service unit. Data and configuration remain in place.

The only pre-backup exception is an explicitly approved recovery from an interrupted first start where the standard database does not exist yet. That recovery creates the initial empty database from the preserved administrator configuration and then immediately uses the ordinary backup path before installing new code. It is never automatic and refuses active services, symlinks, nonstandard database paths, and installations with an earlier backup manifest. See [INSTALL.md](INSTALL.md#retrying-an-interrupted-first-installation).

To select a prior installed release explicitly:

```bash
sudo /opt/netbird-injector-manager/current/setup rollback
sudo /opt/netbird-injector-manager/current/setup status
```

With no argument, rollback selects the newest other installed release. To select an exact reviewed version:

```bash
sudo /opt/netbird-injector-manager/current/setup rollback /opt/netbird-injector-manager/releases/<TIMESTAMP>
```

The target must remain beneath the managed releases directory and pass its internal manifest. Rollback creates a backup and is itself health-gated; a bad rollback candidate causes the former current release to be reinstated.

Code rollback is not database restore. Restore state only after diagnosing a data problem and verifying the chosen backup; see [BACKUP_RESTORE.md](BACKUP_RESTORE.md).
