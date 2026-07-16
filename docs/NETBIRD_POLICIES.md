# Least-privilege NetBird policies

Use dedicated groups so access is auditable and narrow. Placeholder names below are examples, not objects created by this project.

| Direction | Source | Destination | Protocol/port |
|---|---|---|---|
| Proxy ingress | `<REVERSE_PROXY_GROUP>` | `<INJECTOR_GROUP>` | TCP 8080 only |
| Application egress | `<INJECTOR_GROUP>` | `<COOLIFY_APP_GROUP>` | exact application port only |
| Administration | approved administrators | injector SSH service | existing SSH policy only |

Do not expose TCP 9090 through a public NetBird Reverse Proxy service. It is loopback/SSH by default. Optional remote administration binds native HTTPS to one private LAN/NetBird address and must be limited to an administrator group plus matching `admin.allowedCidrs`. Do not grant the injector broad account-to-account access, subnet access, or all ports merely because application configuration also has CIDR and port allowlists; the layers are complementary.

After creating policies, test both positive and negative cases:

- intended proxy peer can reach injector TCP 8080;
- unrelated peers cannot reach TCP 8080;
- injector can reach only the chosen application peer and port;
- injector cannot reach metadata, loopback on other hosts, unrelated private ranges, or unauthorized ports;
- admin TCP 9090 is unreachable except from the explicit administrator group when private HTTPS mode is intentionally enabled;
- removing or disabling API credentials does not affect active traffic.

Record policy IDs, group membership, owner, review date, and screenshots in the external change record. The application cannot verify dashboard policy semantics by itself.
