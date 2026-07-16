# Uninstall

Default uninstall removes the unit and installed code but preserves configuration, the optional token file, database/history, and backups:

```bash
sudo /opt/netbird-injector-manager/current/setup uninstall
```

Reinstalling a verified release reuses preserved configuration and data:

```bash
sudo ./setup install
sudo ./setup doctor
```

Destructive categories require distinct flags. Review and back up first:

```bash
sudo ./setup uninstall --purge-config
sudo ./setup uninstall --purge-data
sudo ./setup uninstall --purge-backups
```

All three may be supplied together only for an approved full removal. The dedicated system account is retained so preserved files never become owned by a recycled numeric UID. Removing that account is a separate host-administration decision after confirming no preserved files remain.

Uninstall never removes or edits NetBird services, policies, peers, DNS, Coolify, Traefik, or the former injection plugin. Traffic rollback is performed first by an authorized NetBird operator.
