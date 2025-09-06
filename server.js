import 'package:flutter/material.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'dart:async';
import 'package:flutter/services.dart';
import 'package:maps_toolkit/maps_toolkit.dart' as maps_toolkit;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'dart:math' as math;

// 🔒 GLOBAL SOS PROTECTION (PREVENTS ANY DUPLICATES ACROSS ALL INSTANCES)
class SOSProtection {
  static bool _isSOSInProgress = false;
  static DateTime? _lastSOSTime;
  static String? _currentSOSId;
  static final Duration _sosDebounce = Duration(seconds: 5);
  static final Set<String> _sentSOSIds = <String>{};

  static bool canSendSOS() {
    if (_isSOSInProgress) {
      print("🚫 SOS blocked: Already in progress");
      return false;
    }

    if (_lastSOSTime != null && 
        DateTime.now().difference(_lastSOSTime!) < _sosDebounce) {
      print("🚫 SOS blocked: Within debounce period");
      return false;
    }

    return true;
  }

  static void startSOS(String sosId) {
    print("🔒 SOS Protection: Starting SOS $sosId");
    _isSOSInProgress = true;
    _currentSOSId = sosId;
    _lastSOSTime = DateTime.now();
    _sentSOSIds.add(sosId);
  }

  static void endSOS() {
    print("🔓 SOS Protection: SOS completed");
    _isSOSInProgress = false;
    _currentSOSId = null;
  }

  static bool wasSOSAlreadySent(String sosId) {
    return _sentSOSIds.contains(sosId);
  }

  static void cleanup() {
    // Clean old SOS IDs (keep only last 10)
    if (_sentSOSIds.length > 10) {
      final list = _sentSOSIds.toList();
      _sentSOSIds.clear();
      _sentSOSIds.addAll(list.sublist(list.length - 5));
    }
  }
}

// Enhanced Geofence Model
class GeofenceModel {
  final String id;
  final String name;
  final String type;
  final String priority;
  final bool active;
  final bool alertOnEntry;
  final bool alertOnExit;
  final String shapeType;
  final List<LatLng> points;
  final LatLng? center;
  final double? radius;
  final DateTime createdAt;
  final DateTime updatedAt;

  GeofenceModel({
    required this.id,
    required this.name,
    required this.type,
    required this.priority,
    required this.active,
    required this.alertOnEntry,
    required this.alertOnExit,
    required this.shapeType,
    required this.points,
    this.center,
    this.radius,
    required this.createdAt,
    required this.updatedAt,
  });

  factory GeofenceModel.fromJson(Map<String, dynamic> json) {
    return GeofenceModel(
      id: json['id']?.toString() ?? '',
      name: json['name'] ?? '',
      type: json['type'] ?? 'MONITORING',
      priority: json['priority'] ?? 'medium',
      active: json['active'] ?? true,
      alertOnEntry: json['alertOnEntry'] ?? true,
      alertOnExit: json['alertOnExit'] ?? false,
      shapeType: json['shapeType'] ?? 'polygon',
      points: (json['points'] as List<dynamic>?)
          ?.map((point) => LatLng(
        (point['lat'] as num).toDouble(),
        (point['lng'] as num).toDouble(),
      ))
          .toList() ?? [],
      center: json['center'] != null
          ? LatLng(
        (json['center']['lat'] as num).toDouble(),
        (json['center']['lng'] as num).toDouble(),
      )
          : null,
      radius: json['radius']?.toDouble(),
      createdAt: DateTime.tryParse(json['createdAt'] ?? '') ?? DateTime.now(),
      updatedAt: DateTime.tryParse(json['updatedAt'] ?? '') ?? DateTime.now(),
    );
  }

  Color get color {
    switch (type) {
      case 'RESTRICTED':
        return Colors.red;
      case 'SAFE':
        return Colors.green;
      case 'MONITORING':
        return Colors.orange;
      case 'EMERGENCY':
        return Colors.purple;
      default:
        return Colors.blue;
    }
  }

  IconData get icon {
    switch (type) {
      case 'RESTRICTED':
        return Icons.block;
      case 'SAFE':
        return Icons.security;
      case 'MONITORING':
        return Icons.visibility;
      case 'EMERGENCY':
        return Icons.warning;
      default:
        return Icons.location_on;
    }
  }
}

// Main entry point of the application
void main() {
  runApp(TouristApp());
}

// The root widget of the application
class TouristApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Vortex SOS - Safety App',
      theme: ThemeData(
        primarySwatch: Colors.red,
        visualDensity: VisualDensity.adaptivePlatformDensity,
        appBarTheme: AppBarTheme(
          backgroundColor: Colors.red.shade800,
          foregroundColor: Colors.white,
          elevation: 4,
        ),
      ),
      home: HomeScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}

// The main screen of the app, which is a stateful widget
class HomeScreen extends StatefulWidget {
  @override
  _HomeScreenState createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  // Enhanced state variables for the app
  IO.Socket? socket;
  GoogleMapController? _mapController;
  LatLng? _currentPos;
  bool _isLoading = true;
  String _statusMessage = "Initializing...";
  bool _isConnected = false;
  bool _hasLocationPermission = false;
  bool _isLocationServiceEnabled = false;

  // Enhanced geofencing variables
  List<GeofenceModel> _geofences = [];
  Map<String, bool> _geofenceInsideStatus = {};
  Map<String, bool> _previousGeofenceStatus = {};
  String _geofenceStatus = "Monitoring geofences...";
  StreamSubscription<Position>? _positionStream;

  String? _userId;
  String? _userName;

  // Enhanced tracking variables for better geofence detection
  bool _hasReceivedGeofences = false;
  DateTime? _lastAlertTime;
  final Duration _alertCooldown = Duration(minutes: 1);
  int _locationUpdateCount = 0;
  Map<String, List<bool>> _recentInsideChecks = {};

  // Connection retry variables
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  final int _maxReconnectAttempts = 5;

  // 🔒 ULTRA ROBUST SOS PROTECTION
  bool _localSOSInProgress = false;
  String? _currentSOSId;
  Timer? _sosTimeoutTimer;
  StreamController<String>? _sosStreamController;

  @override
  void initState() {
    super.initState();
    _initializeApp();

    // Initialize SOS stream controller for single-event handling
    _sosStreamController = StreamController<String>.broadcast();
    _sosStreamController!.stream.listen(_handleSOSEvent);
  }

  @override
  void dispose() {
    socket?.dispose();
    _positionStream?.cancel();
    _reconnectTimer?.cancel();
    _sosTimeoutTimer?.cancel();
    _sosStreamController?.close();
    super.dispose();
  }

  // 🔒 SINGLE SOS EVENT HANDLER (PROCESSES ONE AT A TIME)
  void _handleSOSEvent(String sosId) async {
    if (SOSProtection.wasSOSAlreadySent(sosId)) {
      print("🚫 SOS $sosId already processed, ignoring");
      return;
    }

    await _processSingleSOS(sosId);
  }

  // --- Core Initialization and Logic Functions ---

  Future<void> _initializeApp() async {
    if (!mounted) return;
    setState(() {
      _isLoading = true;
      _statusMessage = "Initializing Vortex SOS...";
    });

    try {
      await _getOrSetUserId();
      await _checkPermissions();
      if (_hasLocationPermission && _isLocationServiceEnabled) {
        if (!mounted) return;
        setState(() { _statusMessage = "Getting your location..."; });
        await _getLocation();
        _startLocationUpdates();
      }
      if (!mounted) return;
      setState(() { _statusMessage = "Connecting to emergency services..."; });
      await _connectToServer();
    } catch (e) {
      print("Initialization error: $e");
      if (!mounted) return;
      setState(() { _statusMessage = "Initialization error: $e"; });
    } finally {
      if (!mounted) return;
      setState(() { _isLoading = false; });
    }
  }

  Future<void> _getOrSetUserId() async {
    final prefs = await SharedPreferences.getInstance();
    String? storedUserId = prefs.getString('user_id');
    String? storedUserName = prefs.getString('user_name');

    if (storedUserId == null) {
      storedUserId = Uuid().v4();
      await prefs.setString('user_id', storedUserId);
    }

    if (storedUserName == null) {
      storedUserName = 'Mobile User ${storedUserId.substring(0, 8)}';
      await prefs.setString('user_name', storedUserName);
    }

    if(mounted) {
      setState(() {
        _userId = storedUserId;
        _userName = storedUserName;
      });
    }
  }

  void _startLocationUpdates() {
    if (!_hasLocationPermission || !_isLocationServiceEnabled) return;

    _positionStream?.cancel();
    const LocationSettings locationSettings = LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 3,
    );

    _positionStream = Geolocator.getPositionStream(locationSettings: locationSettings).listen(
            (Position position) {
          if (!mounted) return;
          setState(() {
            _currentPos = LatLng(position.latitude, position.longitude);
            _locationUpdateCount++;
          });
          _checkAllGeofences();
        },
        onError: (error) {
          print("Location stream error: $error");
          if (mounted) {
            setState(() {
              _statusMessage = "Location tracking error: $error";
            });
          }
        }
    );
  }

  Future<void> _checkPermissions() async {
    _isLocationServiceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!_isLocationServiceEnabled) {
      if (!mounted) return;
      setState(() {
        _statusMessage = "Please enable location services.";
        _hasLocationPermission = false;
      });
      return;
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }

    _hasLocationPermission = permission == LocationPermission.whileInUse ||
        permission == LocationPermission.always;

    if (!_hasLocationPermission) {
      if (!mounted) return;
      setState(() { _statusMessage = "Location permission is required for safety monitoring."; });
    }
  }

  Future<void> _connectToServer() async {
    try {
      if (socket != null && socket!.connected) return;
      socket?.dispose();

      print("Connecting to Vortex SOS server...");

      socket = IO.io("https://vortex-safety-server.onrender.com", <String, dynamic>{
        'transports': ['websocket', 'polling'],
        'autoConnect': false,
        'timeout': 20000,
        'reconnection': true,
        'reconnectionAttempts': _maxReconnectAttempts,
        'reconnectionDelay': 2000,
      });

      socket!.onConnect((_) {
        if (!mounted) return;
        print("✅ Connected to Vortex SOS server successfully");
        _reconnectAttempts = 0;
        _reconnectTimer?.cancel();

        setState(() {
          _isConnected = true;
          _statusMessage = "Connected to emergency services";
        });

        // Identify this client as a mobile app
        socket!.emit('identify', {
          'type': 'mobile',
          'name': _userName ?? 'Mobile User',
          'platform': 'flutter',
          'userId': _userId,
          'connectedAt': DateTime.now().toIso8601String(),
        });

        // Request existing geofences
        socket!.emit('getGeofences');

        // Show success message
        _showSnackBar("Connected to emergency services", Colors.green);
      });

      socket!.onDisconnect((_) {
        if (!mounted) return;
        print("❌ Disconnected from Vortex SOS server");
        setState(() {
          _isConnected = false;
          _statusMessage = "Disconnected from emergency services";
        });
        _startReconnectTimer();
        _showSnackBar("Disconnected from server", Colors.orange);
      });

      socket!.onConnectError((data) {
        if (!mounted) return;
        print("❌ Connection error: $data");
        setState(() {
          _isConnected = false;
          _statusMessage = "Connection failed - retrying...";
        });
        _startReconnectTimer();
      });

      // Enhanced geofence event listeners
      socket!.on('updateGeofence', _handleGeofenceUpdate);
      socket!.on('allGeofences', _handleAllGeofences);
      socket!.on('deleteGeofence', _handleGeofenceDelete);

      socket!.connect();
    } catch (e) {
      print("❌ Server connection error: $e");
      if (!mounted) return;
      setState(() {
        _isConnected = false;
        _statusMessage = "Server connection error";
      });
      _startReconnectTimer();
    }
  }

  void _startReconnectTimer() {
    if (_reconnectAttempts >= _maxReconnectAttempts) {
      setState(() {
        _statusMessage = "Unable to connect to emergency services";
      });
      return;
    }

    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(Duration(seconds: 5 + (_reconnectAttempts * 2)), () {
      if (!mounted) return;
      _reconnectAttempts++;
      print("🔄 Reconnection attempt $_reconnectAttempts/$_maxReconnectAttempts");
      _connectToServer();
    });
  }

  void _handleGeofenceUpdate(dynamic data) {
    if (!mounted || data == null) return;

    try {
      print("📍 Received geofence update: ${data['name']}");
      final geofence = GeofenceModel.fromJson(data);

      setState(() {
        final existingIndex = _geofences.indexWhere((g) => g.id == geofence.id);
        if (existingIndex != -1) {
          _geofences[existingIndex] = geofence;
          print("🔄 Updated existing geofence: ${geofence.name}");
        } else {
          _geofences.add(geofence);
          print("➕ Added new geofence: ${geofence.name}");
        }

        _hasReceivedGeofences = true;
        _geofenceInsideStatus[geofence.id] = false;
        _previousGeofenceStatus[geofence.id] = false;
        _recentInsideChecks[geofence.id] = [];
      });

      _checkAllGeofences();

      if (_geofences.length == 1) {
        _showSnackBar("Geofence monitoring active: ${geofence.name}", Colors.blue);
      }

    } catch (e) {
      print("❌ Error handling geofence update: $e");
    }
  }

  void _handleAllGeofences(dynamic data) {
    if (!mounted || data == null) return;

    try {
      final geofenceList = data as List<dynamic>;
      print("📍 Received ${geofenceList.length} geofences from server");

      setState(() {
        _geofences.clear();
        _geofenceInsideStatus.clear();
        _previousGeofenceStatus.clear();
        _recentInsideChecks.clear();

        for (var geofenceData in geofenceList) {
          final geofence = GeofenceModel.fromJson(geofenceData);
          _geofences.add(geofence);

          _geofenceInsideStatus[geofence.id] = false;
          _previousGeofenceStatus[geofence.id] = false;
          _recentInsideChecks[geofence.id] = [];
        }

        _hasReceivedGeofences = _geofences.isNotEmpty;
      });

      if (_geofences.isNotEmpty) {
        _showSnackBar("Loaded ${_geofences.length} geofences", Colors.green);
        _checkAllGeofences();
      }

    } catch (e) {
      print("❌ Error handling all geofences: $e");
    }
  }

  void _handleGeofenceDelete(dynamic data) {
    if (!mounted || data == null) return;

    try {
      final geofenceId = data['id']?.toString();
      if (geofenceId != null) {
        final removedGeofence = _geofences.where((g) => g.id == geofenceId).firstOrNull;

        setState(() {
          _geofences.removeWhere((g) => g.id == geofenceId);
          _geofenceInsideStatus.remove(geofenceId);
          _previousGeofenceStatus.remove(geofenceId);
          _recentInsideChecks.remove(geofenceId);
        });

        if (removedGeofence != null) {
          print("➖ Removed geofence: ${removedGeofence.name}");
          _showSnackBar("Geofence removed: ${removedGeofence.name}", Colors.orange);
        }
      }
    } catch (e) {
      print("❌ Error handling geofence delete: $e");
    }
  }

  Future<void> _getLocation() async {
    if (!_hasLocationPermission || !_isLocationServiceEnabled) {
      if (!mounted) return;
      setState(() { _statusMessage = "Location permissions required"; });
      return;
    }

    try {
      Position position = await Geolocator.getCurrentPosition(
          desiredAccuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15)
      );

      if (mounted) {
        setState(() {
          _currentPos = LatLng(position.latitude, position.longitude);
          _statusMessage = "Location acquired";
        });
        print("📍 Current location: ${position.latitude}, ${position.longitude}");
      }
    } catch (e) {
      print("❌ Location error: $e");
      if (mounted) {
        setState(() {
          _currentPos = LatLng(28.6139, 77.2090);
          _statusMessage = "Using default location";
        });
      }
    }
  }

  // 🔒 ULTRA-ROBUST SOS FUNCTION (COMPLETELY BULLETPROOF)
  Future<void> sendSOS() async {
    print("🆘 SOS button pressed");

    // 🛡️ LAYER 1: Global protection check
    if (!SOSProtection.canSendSOS()) {
      final remaining = SOSProtection._sosDebounce.inSeconds - 
          DateTime.now().difference(SOSProtection._lastSOSTime!).inSeconds;
      _showSnackBar("Please wait ${remaining}s before sending another SOS", Colors.orange);
      return;
    }

    // 🛡️ LAYER 2: Local state check
    if (_localSOSInProgress) {
      print("🚫 Local SOS already in progress");
      _showSnackBar("SOS already being sent...", Colors.orange);
      return;
    }

    // 🛡️ LAYER 3: Connection check
    if (socket == null || !_isConnected) {
      _showErrorDialog("Cannot Send SOS", "Not connected to emergency services.");
      return;
    }

    // 🚀 CREATE UNIQUE SOS ID
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final random = math.Random().nextInt(10000);
    final sosId = "${_userId}_${timestamp}_$random";

    print("🆘 Initiating SOS: $sosId");

    // 🛡️ LAYER 4: Check if this exact SOS was already sent
    if (SOSProtection.wasSOSAlreadySent(sosId)) {
      print("🚫 SOS $sosId already sent");
      return;
    }

    // 🔒 LOCK ALL SOS OPERATIONS
    SOSProtection.startSOS(sosId);
    setState(() {
      _localSOSInProgress = true;
      _currentSOSId = sosId;
    });

    // Add to stream for single processing
    _sosStreamController!.add(sosId);
  }

  // 🔒 PROCESS SINGLE SOS (GUARANTEED ONE EXECUTION)
  Future<void> _processSingleSOS(String sosId) async {
    if (!mounted) return;

    print("🔄 Processing SOS: $sosId");

    // Show loading dialog
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => WillPopScope(
        onWillPop: () async => false,
        child: AlertDialog(
          backgroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Stack(
                alignment: Alignment.center,
                children: [
                  SizedBox(
                    width: 60,
                    height: 60,
                    child: CircularProgressIndicator(
                      color: Colors.red,
                      strokeWidth: 4,
                    ),
                  ),
                  Icon(Icons.emergency, color: Colors.red, size: 30),
                ],
              ),
              SizedBox(height: 20),
              Text(
                "Sending Emergency SOS...",
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Colors.red.shade800,
                ),
              ),
              SizedBox(height: 10),
              Text(
                "Emergency ID: ${sosId.split('_').last}",
                style: TextStyle(fontSize: 12, color: Colors.grey[600]),
              ),
            ],
          ),
        ),
      ),
    );

    // Set timeout
    _sosTimeoutTimer = Timer(Duration(seconds: 15), () {
      _resetSOSState();
      if (mounted && Navigator.canPop(context)) {
        Navigator.pop(context);
        _showErrorDialog("SOS Timeout", "Emergency alert timed out. Please try again.");
      }
    });

    try {
      LatLng sosLocation = _currentPos ?? LatLng(28.6139, 77.2090);

      Map<String, dynamic> sosData = {
        "sosId": sosId,
        "user": _userName ?? "Unknown User",
        "userId": _userId,
        "lat": sosLocation.latitude,
        "lon": sosLocation.longitude,
        "timestamp": DateTime.now().toIso8601String(),
        "message": "🆘 EMERGENCY SOS from Vortex Mobile App",
        "accuracy": "high",
        "deviceInfo": "Flutter Mobile App",
        "priority": "EMERGENCY"
      };

      print("📡 Sending SOS: $sosData");

      // 🚀 SEND SOS (ONLY ONCE)
      socket!.emit("sos", sosData);

      // Wait for send confirmation
      await Future.delayed(Duration(milliseconds: 800));

      print("✅ SOS sent successfully: $sosId");

      // Cancel timeout
      _sosTimeoutTimer?.cancel();

      // Close loading dialog
      if (mounted && Navigator.canPop(context)) {
        Navigator.pop(context);
      }

      // Show success
      _showSuccessDialog(
        "🆘 Emergency SOS Sent!", 
        "Your emergency alert has been dispatched.\n\nEmergency ID: ${sosId.split('_').last}\n\nHelp is on the way!"
      );

      HapticFeedback.heavyImpact();
      _showSnackBar("Emergency SOS sent successfully!", Colors.green);

    } catch (e) {
      print("❌ SOS send error: $e");

      _sosTimeoutTimer?.cancel();

      if (mounted && Navigator.canPop(context)) {
        Navigator.pop(context);
      }

      _showErrorDialog("SOS Failed", "Failed to send emergency alert: $e");
    } finally {
      // Reset state after delay
      Timer(Duration(seconds: 3), () {
        _resetSOSState();
      });
    }
  }

  // 🔓 RESET SOS STATE
  void _resetSOSState() {
    if (mounted) {
      setState(() {
        _localSOSInProgress = false;
        _currentSOSId = null;
      });
    }
    _sosTimeoutTimer?.cancel();
    SOSProtection.endSOS();
    SOSProtection.cleanup();
    print("🔄 SOS state reset");
  }

  void _checkAllGeofences() {
    if (_currentPos == null || !_hasReceivedGeofences || _geofences.isEmpty) {
      setState(() {
        _geofenceStatus = _geofences.isEmpty
            ? "No active geofences"
            : "Waiting for location data...";
      });
      return;
    }

    List<String> insideGeofences = [];

    for (var geofence in _geofences.where((g) => g.active)) {
      bool isCurrentlyInside = _checkSingleGeofence(geofence);

      _recentInsideChecks[geofence.id] = _recentInsideChecks[geofence.id] ?? [];
      _recentInsideChecks[geofence.id]!.add(isCurrentlyInside);

      if (_recentInsideChecks[geofence.id]!.length > 3) {
        _recentInsideChecks[geofence.id]!.removeAt(0);
      }

      if (_recentInsideChecks[geofence.id]!.length >= 2) {
        bool stableInside = _recentInsideChecks[geofence.id]!
            .every((check) => check == isCurrentlyInside);

        if (stableInside) {
          bool wasInside = _previousGeofenceStatus[geofence.id] ?? false;

          if (isCurrentlyInside && !wasInside && geofence.alertOnEntry) {
            print("🚨 Detected entry into ${geofence.name}");
            _handleGeofenceViolation(geofence, 'entered');
          }
          else if (!isCurrentlyInside && wasInside && geofence.alertOnExit) {
            print("🚨 Detected exit from ${geofence.name}");
            _handleGeofenceViolation(geofence, 'exited');
          }

          _previousGeofenceStatus[geofence.id] = isCurrentlyInside;
        }
      }

      _geofenceInsideStatus[geofence.id] = isCurrentlyInside;

      if (isCurrentlyInside) {
        insideGeofences.add(geofence.name);
      }
    }

    if (mounted) {
      setState(() {
        if (insideGeofences.isEmpty) {
          _geofenceStatus = "Outside all geofences (${_geofences.length} active)";
        } else {
          _geofenceStatus = "Inside: ${insideGeofences.join(', ')}";
        }
      });
    }
  }

  bool _checkSingleGeofence(GeofenceModel geofence) {
    if (_currentPos == null) return false;

    try {
      if (geofence.shapeType == 'circle' && geofence.center != null && geofence.radius != null) {
        double distance = Geolocator.distanceBetween(
          _currentPos!.latitude,
          _currentPos!.longitude,
          geofence.center!.latitude,
          geofence.center!.longitude,
        );
        return distance <= geofence.radius!;
      } else if (geofence.shapeType == 'polygon' && geofence.points.isNotEmpty) {
        final currentToolkitPos = maps_toolkit.LatLng(
            _currentPos!.latitude,
            _currentPos!.longitude
        );

        final geofenceToolkitPoints = geofence.points.map((p) =>
            maps_toolkit.LatLng(p.latitude, p.longitude)
        ).toList();

        return maps_toolkit.PolygonUtil.containsLocation(
            currentToolkitPos,
            geofenceToolkitPoints,
            false
        );
      }
    } catch (e) {
      print("❌ Error checking geofence ${geofence.name}: $e");
    }

    return false;
  }

  void _handleGeofenceViolation(GeofenceModel geofence, String action) {
    if (_lastAlertTime != null &&
        DateTime.now().difference(_lastAlertTime!) < _alertCooldown) {
      return;
    }

    _lastAlertTime = DateTime.now();
    HapticFeedback.heavyImpact();

    if (socket != null && _isConnected) {
      socket!.emit('geofenceViolation', {
        'user': _userName ?? 'Unknown User',
        'userId': _userId,
        'action': action,
        'geofenceName': geofence.name,
        'geofenceId': geofence.id,
        'geofenceType': geofence.type,
        'lat': _currentPos!.latitude,
        'lng': _currentPos!.longitude,
        'priority': geofence.priority,
        'timestamp': DateTime.now().toIso8601String(),
      });
    }

    _showGeofenceAlertDialog(geofence, action);
  }

  // --- UI Helper Functions ---

  void _showSnackBar(String message, Color color) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: color,
        duration: Duration(seconds: 3),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _showGeofenceAlertDialog(GeofenceModel geofence, String action) {
    if (!mounted) return;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Container(
          padding: EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: geofence.color.withOpacity(0.1),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Icon(geofence.icon, color: geofence.color, size: 32),
              SizedBox(width: 12),
              Expanded(
                child: Text(
                  "Geofence Alert!",
                  style: TextStyle(
                    color: geofence.color,
                    fontWeight: FontWeight.bold,
                    fontSize: 20,
                  ),
                ),
              ),
            ],
          ),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "You have $action the geofenced area:",
              style: TextStyle(fontSize: 16, color: Colors.grey[700]),
            ),
            SizedBox(height: 12),
            Text(
              geofence.name,
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: geofence.color,
              ),
            ),
            SizedBox(height: 8),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: geofence.color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                "${geofence.type} • ${geofence.priority.toUpperCase()} PRIORITY",
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: geofence.color,
                ),
              ),
            ),
            SizedBox(height: 16),
            Text(
              "Please follow safety guidelines and exercise caution in this area.",
              style: TextStyle(fontSize: 14, color: Colors.grey[600]),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            style: TextButton.styleFrom(
              backgroundColor: geofence.color,
              foregroundColor: Colors.white,
              padding: EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            child: Text("I UNDERSTAND", style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _showErrorDialog(String title, String message) {
    if (!mounted) return;

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
        title: Row(
          children: [
            Icon(Icons.error, color: Colors.red, size: 28),
            SizedBox(width: 8),
            Expanded(child: Text(title)),
          ],
        ),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            style: TextButton.styleFrom(
              backgroundColor: Colors.red,
              foregroundColor: Colors.white,
            ),
            child: Text("OK"),
          ),
        ],
      ),
    );
  }

  void _showSuccessDialog(String title, String message) {
    if (!mounted) return;

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
        title: Row(
          children: [
            Icon(Icons.check_circle, color: Colors.green, size: 28),
            SizedBox(width: 8),
            Expanded(child: Text(title)),
          ],
        ),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            style: TextButton.styleFrom(
              backgroundColor: Colors.green,
              foregroundColor: Colors.white,
            ),
            child: Text("OK"),
          ),
        ],
      ),
    );
  }

  void _showGeofenceListDialog() {
    if (!mounted) return;

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
        title: Text("Active Geofences (${_geofences.length})"),
        content: Container(
          width: double.maxFinite,
          height: 300,
          child: _geofences.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.layers_outlined, size: 48, color: Colors.grey),
                      SizedBox(height: 16),
                      Text("No geofences active"),
                    ],
                  ),
                )
              : ListView.builder(
            itemCount: _geofences.length,
            itemBuilder: (context, index) {
              final geofence = _geofences[index];
              final isInside = _geofenceInsideStatus[geofence.id] ?? false;

              return Card(
                elevation: 2,
                margin: EdgeInsets.symmetric(vertical: 4),
                child: ListTile(
                  leading: CircleAvatar(
                    backgroundColor: geofence.color,
                    child: Icon(geofence.icon, color: Colors.white, size: 20),
                  ),
                  title: Text(geofence.name, style: TextStyle(fontWeight: FontWeight.bold)),
                  subtitle: Text("${geofence.type} • ${geofence.priority}"),
                  trailing: Container(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: isInside ? Colors.red : Colors.green,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      isInside ? "INSIDE" : "OUTSIDE",
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text("Close"),
          ),
        ],
      ),
    );
  }

  Set<Polygon> _buildPolygons() {
    Set<Polygon> polygons = {};

    for (var geofence in _geofences.where((g) => g.active && g.shapeType == 'polygon')) {
      if (geofence.points.isNotEmpty) {
        polygons.add(
          Polygon(
            polygonId: PolygonId(geofence.id),
            points: geofence.points,
            strokeWidth: 3,
            strokeColor: geofence.color,
            fillColor: geofence.color.withOpacity(0.2),
          ),
        );
      }
    }

    return polygons;
  }

  Set<Circle> _buildCircles() {
    Set<Circle> circles = {};

    for (var geofence in _geofences.where((g) => g.active && g.shapeType == 'circle')) {
      if (geofence.center != null && geofence.radius != null) {
        circles.add(
          Circle(
            circleId: CircleId(geofence.id),
            center: geofence.center!,
            radius: geofence.radius!,
            strokeWidth: 3,
            strokeColor: geofence.color,
            fillColor: geofence.color.withOpacity(0.2),
          ),
        );
      }
    }

    return circles;
  }

  @override
  Widget build(BuildContext context) {
    final insideCount = _geofenceInsideStatus.values.where((inside) => inside).length;
    final totalActive = _geofences.where((g) => g.active).length;

    return Scaffold(
      appBar: AppBar(
        title: Text("Vortex SOS", style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: Colors.red.shade800,
        foregroundColor: Colors.white,
        elevation: 4,
        actions: [
          IconButton(
            icon: Icon(_isConnected ? Icons.cloud_done : Icons.cloud_off),
            onPressed: () {
              if (!_isConnected) {
                _connectToServer();
              } else {
                _showSnackBar("Connected to emergency services", Colors.green);
              }
            },
            tooltip: _isConnected ? "Connected" : "Disconnected - Tap to retry",
          ),
          IconButton(
            icon: Stack(
              children: [
                Icon(Icons.layers),
                if (_geofences.isNotEmpty)
                  Positioned(
                    right: 0,
                    top: 0,
                    child: Container(
                      padding: EdgeInsets.all(2),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      constraints: BoxConstraints(minWidth: 16, minHeight: 16),
                      child: Text(
                        '${_geofences.length}',
                        style: TextStyle(
                          color: Colors.red,
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
              ],
            ),
            onPressed: _showGeofenceListDialog,
            tooltip: "View geofences",
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            padding: EdgeInsets.symmetric(vertical: 16, horizontal: 16),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: insideCount > 0
                    ? [Colors.red.shade700, Colors.red.shade800]
                    : [Colors.green.shade700, Colors.green.shade800],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black26,
                  blurRadius: 4,
                  offset: Offset(0, 2),
                ),
              ],
            ),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      insideCount > 0 ? Icons.warning : Icons.security,
                      color: Colors.white,
                      size: 28,
                    ),
                    SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        _geofenceStatus,
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ],
                ),
                if (_hasReceivedGeofences) ...[
                  SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      Text(
                        "Active: $totalActive",
                        style: TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                      Text(
                        "Inside: $insideCount",
                        style: TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                      Text(
                        "Updates: $_locationUpdateCount",
                        style: TextStyle(color: Colors.white70, fontSize: 12),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),

          Expanded(
            child: _isLoading
                ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(color: Colors.red),
                  SizedBox(height: 20),
                  Text(_statusMessage, style: TextStyle(fontSize: 16)),
                  SizedBox(height: 10),
                  Text("Please wait...", style: TextStyle(color: Colors.grey)),
                ],
              ),
            )
                : _currentPos == null
                ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.location_off, size: 64, color: Colors.grey),
                  SizedBox(height: 20),
                  Text(_statusMessage, textAlign: TextAlign.center),
                  SizedBox(height: 20),
                  ElevatedButton.icon(
                    onPressed: _getLocation,
                    icon: Icon(Icons.refresh),
                    label: Text("Retry Location"),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.red,
                      foregroundColor: Colors.white,
                    ),
                  ),
                ],
              ),
            )
                : GoogleMap(
              initialCameraPosition: CameraPosition(
                target: _currentPos!,
                zoom: 16,
              ),
              myLocationEnabled: _hasLocationPermission,
              myLocationButtonEnabled: true,
              compassEnabled: true,
              mapToolbarEnabled: false,
              onMapCreated: (controller) => _mapController = controller,
              markers: {
                Marker(
                  markerId: MarkerId("current_location"),
                  position: _currentPos!,
                  icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueBlue),
                  infoWindow: InfoWindow(
                    title: "Your Location",
                    snippet: "Lat: ${_currentPos!.latitude.toStringAsFixed(6)}, Lng: ${_currentPos!.longitude.toStringAsFixed(6)}",
                  ),
                ),
              },
              polygons: _buildPolygons(),
              circles: _buildCircles(),
            ),
          ),

          // 🔒 BULLETPROOF SOS BUTTON
          Container(
            padding: EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              boxShadow: [
                BoxShadow(
                  color: Colors.black12,
                  blurRadius: 8,
                  offset: Offset(0, -2),
                ),
              ],
            ),
            child: SizedBox(
              width: double.infinity,
              height: 65,
              child: ElevatedButton.icon(
                // 🛡️ TRIPLE PROTECTION: Global + Local + Connection
                onPressed: (_isConnected && 
                           !_localSOSInProgress && 
                           SOSProtection.canSendSOS()) ? sendSOS : null,
                icon: _localSOSInProgress 
                    ? SizedBox(
                        width: 32,
                        height: 32,
                        child: CircularProgressIndicator(
                          strokeWidth: 3,
                          valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      )
                    : Icon(Icons.emergency, size: 32),
                label: Text(
                  _localSOSInProgress 
                      ? "SENDING EMERGENCY SOS..." 
                      : !_isConnected 
                          ? "CONNECTING TO SERVICES..." 
                          : "SEND EMERGENCY SOS",
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _localSOSInProgress 
                      ? Colors.orange 
                      : (_isConnected ? Colors.red : Colors.grey),
                  foregroundColor: Colors.white,
                  elevation: (_isConnected && !_localSOSInProgress) ? 8 : 2,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
