import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';

/// Lo que se manda a lavar al final del turno —toallas, trapos, manteles…—
/// para contarlo cuando vuelve y anotar la diferencia como merma. Lo lleva
/// quien trabaja en el local: todos menos el rol «usuario».
class Lavanderia extends StatefulWidget {
  const Lavanderia({super.key});

  @override
  State<Lavanderia> createState() => _LavanderiaState();
}

class _LavanderiaState extends State<Lavanderia> {
  List<EnvioLavanderia> _envios = [];
  bool _cargando = true;
  String? _error;
  bool _iniciado = false;

  int? _localId;
  // Por defecto se esconden los ya contados: son los pendientes los que hay
  // que seguir mirando.
  String? _estado = 'pendiente';
  DateTime? _desde;
  DateTime? _hasta;

  static String _dia(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() => _cargando = true);
    try {
      final api = SesionScope.de(context).api;
      final datos = await api.get('/api/lavanderia', {
        'local_id': _localId,
        'estado': _estado,
        // El rango es opcional: con solo una punta puesta se ignora, para no
        // mandar una fecha sin la otra.
        if (_desde != null && _hasta != null) 'desde': _dia(_desde!),
        if (_desde != null && _hasta != null) 'hasta': _dia(_hasta!),
      }) as List;
      if (!mounted) return;
      setState(() {
        _envios = datos.map((e) => EnvioLavanderia.desdeJson(e as Map<String, dynamic>)).toList();
        _error = null;
        _cargando = false;
      });
    } on ErrorApi catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.mensaje;
        _cargando = false;
      });
    }
  }

  Future<void> _nuevo() async {
    final creado = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const NuevoEnvio()),
    );
    if (creado == true) _cargar();
  }

  Future<void> _recibir(EnvioLavanderia envio) async {
    final contado = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => RecepcionEnvio(envio: envio)),
    );
    if (contado == true) _cargar();
  }

  @override
  Widget build(BuildContext context) {
    final meta = SesionScope.de(context).meta;

    return Scaffold(
      appBar: AppBar(title: const Text('Lavandería')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _nuevo,
        icon: const Icon(Icons.add),
        label: const Text('Nuevo envío'),
      ),
      body: RefreshIndicator(
        onRefresh: _cargar,
        child: ListView(
          padding: EdgeInsets.fromLTRB(12, 12, 12, 90 + margenSistema(context)),
          children: [
            _filtros(meta),
            const SizedBox(height: 8),
            if (_cargando && _envios.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null && _envios.isEmpty)
              Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar)
            else if (_envios.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 40),
                child: Aviso(
                  icono: Icons.local_laundry_service_outlined,
                  texto: 'Sin envíos todavía. Registra uno con el botón de abajo.',
                ),
              )
            else
              for (final e in _envios) _tarjetaEnvio(e),
          ],
        ),
      ),
    );
  }

  Future<void> _elegirFecha({required bool inicio}) async {
    final elegida = await showDatePicker(
      context: context,
      initialDate: (inicio ? _desde : _hasta) ?? DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(DateTime.now().year + 1, 12, 31),
      locale: const Locale('es'),
    );
    if (elegida == null) return;
    setState(() {
      if (inicio) {
        _desde = elegida;
        // Un rango al revés no lo acepta el servidor; se corrige aquí.
        if (_hasta != null && _desde!.isAfter(_hasta!)) _hasta = _desde;
      } else {
        _hasta = elegida;
        if (_desde != null && _hasta!.isBefore(_desde!)) _desde = _hasta;
      }
    });
    _cargar();
  }

  void _limpiarFechas() {
    setState(() {
      _desde = null;
      _hasta = null;
    });
    _cargar();
  }

  Widget _filtros(Meta? meta) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<int>(
                value: _localId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Local', isDense: true),
                items: [
                  const DropdownMenuItem(value: null, child: Text('Todos')),
                  for (final l in meta?.localesPropios ?? const <Catalogo>[])
                    DropdownMenuItem(value: l.id, child: Text(l.nombre)),
                ],
                onChanged: (v) {
                  setState(() => _localId = v);
                  _cargar();
                },
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: DropdownButtonFormField<String>(
                value: _estado,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Estado', isDense: true),
                items: const [
                  DropdownMenuItem(value: 'pendiente', child: Text('Esperando la vuelta')),
                  DropdownMenuItem(value: 'recibido', child: Text('Ya contados')),
                  DropdownMenuItem(value: null, child: Text('Todos')),
                ],
                onChanged: (v) {
                  setState(() => _estado = v);
                  _cargar();
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(child: _fechaOpcional('Desde', _desde, () => _elegirFecha(inicio: true))),
            const SizedBox(width: 10),
            Expanded(child: _fechaOpcional('Hasta', _hasta, () => _elegirFecha(inicio: false))),
            if (_desde != null || _hasta != null)
              IconButton(
                tooltip: 'Quitar el rango de fechas',
                onPressed: _limpiarFechas,
                icon: const Icon(Icons.close, size: 18),
              ),
          ],
        ),
      ],
    );
  }

  Widget _fechaOpcional(String etiqueta, DateTime? valor, VoidCallback alPulsar) {
    return InkWell(
      onTap: alPulsar,
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(labelText: etiqueta, isDense: true),
        child: Text(
          valor == null ? 'Cualquiera' : DateFormat('d MMM y', 'es').format(valor),
          style: const TextStyle(fontSize: 14),
        ),
      ),
    );
  }

  Widget _tarjetaEnvio(EnvioLavanderia e) {
    final fmt = DateFormat('d MMM y, HH:mm', 'es');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Tarjeta(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(e.localNombre, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
                        Text(
                          'Enviado por ${e.creadoPorNombre}'
                          '${e.creadoEn != null ? ' · ${fmt.format(e.creadoEn!)}' : ''}',
                          style: const TextStyle(fontSize: 12, color: Tema.gris),
                        ),
                      ],
                    ),
                  ),
                  Distintivo(
                    texto: e.pendiente ? 'Esperando la vuelta' : 'Contado',
                    color: e.pendiente ? Tema.ambar : Tema.verde,
                  ),
                ],
              ),
              const SizedBox(height: 10),
              for (final i in e.items) _filaItem(i),
              if (e.notas != null && e.notas!.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text('Notas del envío: ${e.notas}', style: const TextStyle(fontSize: 12, color: Tema.gris)),
              ],
              if (!e.pendiente && e.notasRecepcion != null && e.notasRecepcion!.isNotEmpty)
                Text('Notas de la recepción: ${e.notasRecepcion}',
                    style: const TextStyle(fontSize: 12, color: Tema.gris)),
              if (e.pendiente) ...[
                const SizedBox(height: 10),
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton(
                    onPressed: () => _recibir(e),
                    child: const Text('Registrar recepción'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _filaItem(ItemLavanderia i) {
    final merma = i.merma;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(child: Text(i.prendaNombre, style: const TextStyle(fontSize: 13))),
          SizedBox(width: 60, child: Text('Env: ${i.enviado}', style: const TextStyle(fontSize: 12, color: Tema.gris))),
          SizedBox(
            width: 60,
            child: Text(
              i.recibido == null ? 'Rec: —' : 'Rec: ${i.recibido}',
              style: const TextStyle(fontSize: 12, color: Tema.gris),
            ),
          ),
          SizedBox(
            width: 70,
            child: Text(
              merma == null ? '' : (merma > 0 ? 'Merma: $merma' : 'Sin merma'),
              style: TextStyle(
                fontSize: 12,
                fontWeight: merma != null && merma > 0 ? FontWeight.w700 : FontWeight.normal,
                color: merma != null && merma > 0 ? Tema.rojo : Tema.gris,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// El formulario de un envío nuevo: local y cuántas prendas de cada una.
class NuevoEnvio extends StatefulWidget {
  const NuevoEnvio({super.key});

  @override
  State<NuevoEnvio> createState() => _NuevoEnvioState();
}

class _NuevoEnvioState extends State<NuevoEnvio> {
  int? _localId;
  final _notas = TextEditingController();
  final Map<int, TextEditingController> _cantidades = {};
  bool _enviando = false;
  String? _error;
  bool _iniciado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    final propios = SesionScope.de(context).meta?.localesPropios ?? const <Catalogo>[];
    if (propios.length == 1) _localId = propios.first.id;
  }

  TextEditingController _controladorDe(int prendaId) =>
      _cantidades.putIfAbsent(prendaId, () => TextEditingController());

  @override
  void dispose() {
    _notas.dispose();
    for (final c in _cantidades.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _guardar() async {
    if (_localId == null) {
      setState(() => _error = 'Elige el local.');
      return;
    }
    final meta = SesionScope.de(context).meta;
    final items = [
      for (final p in meta?.prendasLavanderia ?? const <Catalogo>[])
        {'prenda_id': p.id, 'enviado': int.tryParse(_controladorDe(p.id).text) ?? 0},
    ].where((i) => (i['enviado'] as int) > 0).toList();
    if (items.isEmpty) {
      setState(() => _error = 'Indica al menos una prenda con cantidad enviada.');
      return;
    }

    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await SesionScope.de(context).api.post('/api/lavanderia', {
        'local_id': _localId,
        'notas': _notas.text.trim(),
        'items': items,
      });
      if (mounted) Navigator.pop(context, true);
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final meta = SesionScope.de(context).meta;
    final locales = meta?.localesPropios ?? const <Catalogo>[];
    final prendas = meta?.prendasLavanderia ?? const <Catalogo>[];

    return Scaffold(
      appBar: AppBar(title: const Text('Nuevo envío')),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + margenSistema(context)),
        children: [
          DropdownButtonFormField<int>(
            value: _localId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Local'),
            items: [
              for (final l in locales) DropdownMenuItem(value: l.id, child: Text(l.nombre)),
            ],
            onChanged: (v) => setState(() => _localId = v),
          ),
          const SizedBox(height: 20),
          const Text('Cuántas mandas de cada una',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          for (final p in prendas)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  Expanded(child: Text(p.nombre)),
                  SizedBox(
                    width: 90,
                    child: TextField(
                      controller: _controladorDe(p.id),
                      keyboardType: TextInputType.number,
                      textAlign: TextAlign.center,
                      decoration: const InputDecoration(isDense: true, hintText: '0'),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 10),
          TextField(
            controller: _notas,
            minLines: 2,
            maxLines: 4,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Notas (opcional)'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(_error!, style: const TextStyle(color: Tema.rojo, fontSize: 13.5)),
          ],
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _enviando ? null : _guardar,
            child: _enviando
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Guardar'),
          ),
        ],
      ),
    );
  }
}

/// El formulario para contar la vuelta de un envío: cuánto ha vuelto de
/// verdad de cada prenda. Si falta algo, la diferencia queda como merma.
class RecepcionEnvio extends StatefulWidget {
  const RecepcionEnvio({super.key, required this.envio});

  final EnvioLavanderia envio;

  @override
  State<RecepcionEnvio> createState() => _RecepcionEnvioState();
}

class _RecepcionEnvioState extends State<RecepcionEnvio> {
  final _notas = TextEditingController();
  final Map<int, TextEditingController> _cantidades = {};
  bool _enviando = false;
  String? _error;

  TextEditingController _controladorDe(ItemLavanderia item) => _cantidades.putIfAbsent(
      item.prendaId, () => TextEditingController(text: '${item.enviado}'));

  @override
  void dispose() {
    _notas.dispose();
    for (final c in _cantidades.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _guardar() async {
    final items = [
      for (final i in widget.envio.items)
        {'prenda_id': i.prendaId, 'recibido': int.tryParse(_controladorDe(i).text) ?? 0},
    ];

    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await SesionScope.de(context).api.put('/api/lavanderia/${widget.envio.id}/recepcion', {
        'notas_recepcion': _notas.text.trim(),
        'items': items,
      });
      if (mounted) Navigator.pop(context, true);
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Contar la vuelta')),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + margenSistema(context)),
        children: [
          Text(widget.envio.localNombre, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          const Text(
            'Cuántas han vuelto de verdad. Si faltan, la diferencia queda como merma.',
            style: TextStyle(fontSize: 12.5, color: Tema.gris),
          ),
          const SizedBox(height: 16),
          for (final i in widget.envio.items)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  Expanded(
                    child: Text('${i.prendaNombre} (enviado: ${i.enviado})'),
                  ),
                  SizedBox(
                    width: 90,
                    child: TextField(
                      controller: _controladorDe(i),
                      keyboardType: TextInputType.number,
                      textAlign: TextAlign.center,
                      decoration: const InputDecoration(isDense: true),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 10),
          TextField(
            controller: _notas,
            minLines: 2,
            maxLines: 4,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Notas (opcional)'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(_error!, style: const TextStyle(color: Tema.rojo, fontSize: 13.5)),
          ],
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _enviando ? null : _guardar,
            child: _enviando
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Guardar'),
          ),
        ],
      ),
    );
  }
}
