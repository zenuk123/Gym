"""Shaped like real `ConvertTo-Json` output from Windows PowerShell 5.1 (enums as numbers)."""

WINDOWS_JSON = {
    "adapters": [
        {"Name": "Wi-Fi", "InterfaceDescription": "Intel(R) Wi-Fi 6 AX201 160MHz", "InterfaceIndex": 12,
         "InterfaceGuid": "{11111111-2222-3333-4444-555555555555}", "MediaType": "Native 802.11",
         "PhysicalMediaType": "Native 802.11", "LinkSpeed": "866.7 Mbps", "Virtual": False, "HardwareInterface": True},
        {"Name": "vEthernet (Default Switch)", "InterfaceDescription": "Hyper-V Virtual Ethernet Adapter",
         "InterfaceIndex": 30, "InterfaceGuid": "{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}", "MediaType": "802.3",
         "PhysicalMediaType": "Unspecified", "LinkSpeed": "10 Gbps", "Virtual": True, "HardwareInterface": False},
        {"Name": "Ethernet", "InterfaceDescription": "Realtek PCIe GbE Family Controller", "InterfaceIndex": 7,
         "InterfaceGuid": "{77777777-2222-3333-4444-555555555555}", "MediaType": "802.3", "PhysicalMediaType": "802.3",
         "LinkSpeed": "1 Gbps", "Virtual": False, "HardwareInterface": True},
    ],
    "addresses": [
        {"InterfaceIndex": 12, "IPAddress": "192.168.1.23", "AddressFamily": 2},
        {"InterfaceIndex": 12, "IPAddress": "fe80::1234:5678:9abc:def0%12", "AddressFamily": 23},
        {"InterfaceIndex": 12, "IPAddress": "2a02:c7f:1234:5600:1111:2222:3333:4444", "AddressFamily": 23},
        {"InterfaceIndex": 30, "IPAddress": "172.20.0.1", "AddressFamily": 2},
        {"InterfaceIndex": 7, "IPAddress": "192.168.1.40", "AddressFamily": 2},
    ],
    "dns": [
        {"InterfaceIndex": 12, "AddressFamily": 2, "ServerAddresses": ["192.168.1.1"]},
        {"InterfaceIndex": 12, "AddressFamily": 23, "ServerAddresses": ["fe80::1%12"]},
        {"InterfaceIndex": 30, "AddressFamily": 2, "ServerAddresses": []},
        {"InterfaceIndex": 30, "AddressFamily": 23, "ServerAddresses": ["fec0:0:0:ffff::1", "fec0:0:0:ffff::2", "fec0:0:0:ffff::3"]},
        {"InterfaceIndex": 7, "AddressFamily": 2, "ServerAddresses": "192.168.1.1"},
    ],
    "routes": [
        {"InterfaceIndex": 12, "NextHop": "192.168.1.1", "RouteMetric": 0, "DestinationPrefix": "0.0.0.0/0"},
        {"InterfaceIndex": 12, "NextHop": "fe80::1", "RouteMetric": 0, "DestinationPrefix": "::/0"},
        {"InterfaceIndex": 7, "NextHop": "192.168.1.1", "RouteMetric": 0, "DestinationPrefix": "0.0.0.0/0"},
    ],
    "interfaces": [
        {"InterfaceIndex": 12, "AddressFamily": 2, "InterfaceMetric": 35, "ConnectionState": 1},
        {"InterfaceIndex": 7, "AddressFamily": 2, "InterfaceMetric": 25, "ConnectionState": 1},
        {"InterfaceIndex": 12, "AddressFamily": 23, "InterfaceMetric": 35, "ConnectionState": 1},
    ],
    "profiles": [{"InterfaceIndex": 12, "IPv4Connectivity": 4, "IPv6Connectivity": 4},
                 {"InterfaceIndex": 7, "IPv4Connectivity": 4, "IPv6Connectivity": 1}],
}

VPN_JSON = {
    "adapters": [
        {"Name": "Wi-Fi", "InterfaceDescription": "Killer Wi-Fi", "InterfaceIndex": 5, "PhysicalMediaType": "Native 802.11"},
        {"Name": "NordLynx", "InterfaceDescription": "NordLynx Tunnel", "InterfaceIndex": 40, "PhysicalMediaType": "Unspecified"},
    ],
    "addresses": {"InterfaceIndex": 5, "IPAddress": "10.0.0.5", "AddressFamily": 2},
    "dns": [{"InterfaceIndex": 5, "AddressFamily": 2, "ServerAddresses": ["10.0.0.1"]},
            {"InterfaceIndex": 40, "AddressFamily": 2, "ServerAddresses": ["103.86.96.100"]}],
    "routes": [{"InterfaceIndex": 5, "NextHop": "10.0.0.1", "RouteMetric": 0, "DestinationPrefix": "0.0.0.0/0"},
               {"InterfaceIndex": 40, "NextHop": "0.0.0.0", "RouteMetric": 0, "DestinationPrefix": "0.0.0.0/0"}],
    "interfaces": [{"InterfaceIndex": 5, "AddressFamily": 2, "InterfaceMetric": 50},
                   {"InterfaceIndex": 40, "AddressFamily": 2, "InterfaceMetric": 1}],
    "profiles": None,
}
