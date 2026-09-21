import { Tanker } from '../types';

export const DEPOT_LOCATION = {
  name: 'Central Water Depot A (Chembur)',
  lat: 19.0350,
  lng: 72.8980
};

export const INITIAL_TANKERS: Tanker[] = [
  {
    id: 'T-2045',
    vehicleNumber: 'MH-01-WT-2045',
    driverName: 'Rameshwar Yadav',
    driverPhone: '+91 98204 88120',
    capacity: 10000,
    currentLoad: 8000,
    status: 'En Route',
    currentLocationName: 'Eastern Express Hwy near Ghatkopar',
    destinationCommunity: 'Shivaji Nagar',
    eta: '12 min',
    speedKmH: 34,
    progressPercent: 74,
    currentCoordinates: [19.0550, 72.9180],
    routeWaypoints: [
      [19.0350, 72.8980], // Depot
      [19.0480, 72.9100],
      [19.0550, 72.9180], // Current
      [19.0607, 72.9264], // Shivaji Nagar Stop 1
      [19.0657, 72.8837], // Kurla East Stop 2
      [19.0434, 72.8567]  // Dharavi Stop 3
    ],
    stops: ['Shivaji Nagar', 'Kurla East', 'Dharavi']
  },
  {
    id: 'T-1821',
    vehicleNumber: 'MH-01-WT-1821',
    driverName: 'Dilip Sawant',
    driverPhone: '+91 98199 44102',
    capacity: 12000,
    currentLoad: 12000,
    status: 'Loading',
    currentLocationName: 'Depot A - Bay 3 Loading Gantry',
    destinationCommunity: 'Kurla East',
    eta: '28 min',
    speedKmH: 0,
    progressPercent: 15,
    currentCoordinates: [19.0350, 72.8980],
    routeWaypoints: [
      [19.0350, 72.8980],
      [19.0480, 72.8920],
      [19.0657, 72.8837]
    ],
    stops: ['Kurla East']
  },
  {
    id: 'T-1934',
    vehicleNumber: 'MH-01-WT-1934',
    driverName: 'Abdul Qadir',
    driverPhone: '+91 98201 55904',
    capacity: 10000,
    currentLoad: 0,
    status: 'Delivered',
    currentLocationName: 'Dharavi Kumbharwada Standpost',
    destinationCommunity: 'Dharavi',
    eta: 'Completed',
    speedKmH: 0,
    progressPercent: 100,
    currentCoordinates: [19.0434, 72.8567],
    routeWaypoints: [
      [19.0350, 72.8980],
      [19.0390, 72.8750],
      [19.0434, 72.8567]
    ],
    stops: ['Dharavi']
  },
  {
    id: 'T-2102',
    vehicleNumber: 'MH-01-WT-2102',
    driverName: 'Sanjay Ghag',
    driverPhone: '+91 98670 12093',
    capacity: 15000,
    currentLoad: 15000,
    status: 'En Route',
    currentLocationName: 'Sion-Trombay Rd towards Govandi',
    destinationCommunity: 'Govandi',
    eta: '16 min',
    speedKmH: 28,
    progressPercent: 55,
    currentCoordinates: [19.0480, 72.9080],
    routeWaypoints: [
      [19.0350, 72.8980],
      [19.0480, 72.9080],
      [19.0558, 72.9158]
    ],
    stops: ['Govandi']
  },
  {
    id: 'T-2150',
    vehicleNumber: 'MH-01-WT-2150',
    driverName: 'Harishankar Tiwari',
    driverPhone: '+91 98920 33810',
    capacity: 10000,
    currentLoad: 10000,
    status: 'En Route',
    currentLocationName: 'Mankhurd Link Road',
    destinationCommunity: 'Mankhurd',
    eta: '22 min',
    speedKmH: 30,
    progressPercent: 40,
    currentCoordinates: [19.0420, 72.9200],
    routeWaypoints: [
      [19.0350, 72.8980],
      [19.0420, 72.9200],
      [19.0522, 72.9324]
    ],
    stops: ['Mankhurd']
  },
  {
    id: 'T-1740',
    vehicleNumber: 'MH-01-WT-1740',
    driverName: 'Kailash Mehra',
    driverPhone: '+91 98701 44523',
    capacity: 8000,
    currentLoad: 8000,
    status: 'Idle',
    currentLocationName: 'Depot A Reserve Fleet',
    destinationCommunity: 'Reserve Standby',
    eta: 'Standby',
    speedKmH: 0,
    progressPercent: 0,
    currentCoordinates: [19.0350, 72.8980],
    routeWaypoints: [],
    stops: []
  },
  {
    id: 'T-1888',
    vehicleNumber: 'MH-01-WT-1888',
    driverName: 'Mahesh Solanki',
    driverPhone: '+91 98190 77123',
    capacity: 12000,
    currentLoad: 0,
    status: 'Delivered',
    currentLocationName: 'Chembur Naka Ward Office',
    destinationCommunity: 'Chembur',
    eta: 'Completed',
    speedKmH: 0,
    progressPercent: 100,
    currentCoordinates: [19.0622, 72.8995],
    routeWaypoints: [
      [19.0350, 72.8980],
      [19.0622, 72.8995]
    ],
    stops: ['Chembur']
  },
  {
    id: 'T-1690',
    vehicleNumber: 'MH-01-WT-1690',
    driverName: 'Pravin Gaikwad',
    driverPhone: '+91 98212 99014',
    capacity: 10000,
    currentLoad: 10000,
    status: 'Loading',
    currentLocationName: 'Depot A - Bay 1',
    destinationCommunity: 'Vikhroli',
    eta: '35 min',
    speedKmH: 0,
    progressPercent: 20,
    currentCoordinates: [19.0350, 72.8980],
    routeWaypoints: [
      [19.0350, 72.8980],
      [19.0700, 72.9150],
      [19.1110, 72.9277]
    ],
    stops: ['Vikhroli']
  }
];
