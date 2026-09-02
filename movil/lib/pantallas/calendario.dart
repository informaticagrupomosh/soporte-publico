import 'package:flutter/material.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';
import 'tareas.dart';

const _mesesLargo = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
// La semana se enseña empezando en lunes; DateTime.weekday ya es 1=lunes..7=domingo.
const _diasSemanaCorto = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

// El estado manda sobre si es interno o externo: una tarea cerrada o
// atrasada tiene que verse así aunque además sea de mantenimiento externo.
Color _colorEvento(EventoCalendario e) {
  if (e.cerrada) return Tema.verde;
  if (e.atrasada) return Tema.rojo;
  return e.mantenimientoExterno ? Tema.ambar : Tema.azul;
}

const _textosEstado = {
  'cerrada': 'Cerrada',
  'atrasada': 'Atrasada',
  'pendiente': 'Pendiente hoy',
  'programada': 'Programada',
};

String _textoEstado(String estado) => _textosEstado[estado] ?? 'Programada';

/// El calendario de mantenimiento preventivo, como el de Google Calendar: una
/// vista de año con doce minicalendarios, y al tocar uno, la agenda completa
/// de ese mes con las tareas de cada día. Lo llevan el gestor, el
/// administrador y, para consultarlo, también el técnico.
class Calendario extends StatefulWidget {
  const Calendario({super.key});

  @override
  State<Calendario> createState() => _CalendarioState();
}

enum _Vista { anio, mes }

class _CalendarioState extends State<Calendario> {
  bool _cargando = true;
  String? _error;
  bool _iniciado = false;

  _Vista _vista = _Vista.mes;
  final DateTime _hoy = DateTime.now();
  late int _anio = _hoy.year;
  late int _mes = _hoy.month;

  List<MesCalendario> _meses = [];
  Map<int, List<EventoCalendario>> _dias = {};

  int? _areaId;
  int? _familiaId;
  bool? _externo;
  int? _empresaId;

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
      final datos = await api.get('/api/calendario', {
        'anio': _anio,
        if (_vista == _Vista.mes) 'mes': _mes,
        'area_id': _areaId,
        'familia_id': _familiaId,
        'empresa_id': _empresaId,
        if (_externo != null) 'mantenimiento_externo': _externo! ? 1 : 0,
      }) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        if (_vista == _Vista.anio) {
          _meses = (datos['meses'] as List? ?? [])
              .map((e) => MesCalendario.desdeJson(e as Map<String, dynamic>))
              .toList();
        } else {
          final dias = (datos['dias'] as Map<String, dynamic>? ?? {});
          _dias = dias.map((k, v) => MapEntry(
                int.parse(k),
                (v as List).map((e) => EventoCalendario.desdeJson(e as Map<String, dynamic>)).toList(),
              ));
        }
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

  void _irAMes(int mes) {
    setState(() {
      _vista = _Vista.mes;
      _mes = mes;
    });
    _cargar();
  }

  void _irAAnio() {
    setState(() => _vista = _Vista.anio);
    _cargar();
  }

  void _anterior() {
    setState(() {
      if (_vista == _Vista.anio) {
        _anio -= 1;
      } else if (--_mes < 1) {
        _mes = 12;
        _anio -= 1;
      }
    });
    _cargar();
  }

  void _siguiente() {
    setState(() {
      if (_vista == _Vista.anio) {
        _anio += 1;
      } else if (++_mes > 12) {
        _mes = 1;
        _anio += 1;
      }
    });
    _cargar();
  }

  void _hoyPulsado() {
    setState(() {
      _anio = _hoy.year;
      _mes = _hoy.month;
    });
    _cargar();
  }

  @override
  Widget build(BuildContext context) {
    final meta = SesionScope.de(context).meta;

    return Scaffold(
      appBar: AppBar(
        title: Text(_vista == _Vista.anio ? '$_anio' : '${_mesesLargo[_mes - 1]} $_anio'),
        leading: _vista == _Vista.mes
            ? IconButton(icon: const Icon(Icons.arrow_back), onPressed: _irAAnio)
            : null,
        actions: [
          IconButton(icon: const Icon(Icons.chevron_left), onPressed: _anterior),
          TextButton(onPressed: _hoyPulsado, child: const Text('Hoy')),
          IconButton(icon: const Icon(Icons.chevron_right), onPressed: _siguiente),
          IconButton(
            icon: const Icon(Icons.filter_alt_outlined),
            onPressed: () => _abrirFiltros(meta),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _cargar,
        child: _cargando
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? ListView(children: [
                    const SizedBox(height: 60),
                    Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar),
                  ])
                : _vista == _Vista.anio
                    ? _vistaAnio()
                    : _vistaMes(),
      ),
    );
  }

  Future<void> _abrirFiltros(Meta? meta) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _HojaFiltrosCalendario(
        meta: meta,
        areaId: _areaId,
        familiaId: _familiaId,
        empresaId: _empresaId,
        externo: _externo,
        alAplicar: ({areaId, familiaId, empresaId, externo}) {
          setState(() {
            _areaId = areaId;
            _familiaId = familiaId;
            _empresaId = empresaId;
            _externo = externo;
          });
          _cargar();
        },
      ),
    );
  }

  // ---------- Vista de año ----------

  Widget _vistaAnio() {
    return GridView.builder(
      padding: EdgeInsets.fromLTRB(12, 12, 12, 12 + margenSistema(context)),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 0.92,
        crossAxisSpacing: 8,
        mainAxisSpacing: 8,
      ),
      itemCount: _meses.length,
      itemBuilder: (_, i) => _miniMes(_meses[i]),
    );
  }

  Widget _miniMes(MesCalendario m) {
    final diasEnMes = DateTime(_anio, m.mes + 1, 0).day;
    final primerDiaSemana = DateTime(_anio, m.mes, 1).weekday; // 1=lunes..7=domingo
    final diasConTarea = m.dias.toSet();

    return Tarjeta(
      child: InkWell(
        onTap: () => _irAMes(m.mes),
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Text(_mesesLargo[m.mes - 1],
                      style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                  if (m.tareas > 0) ...[
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                      decoration: BoxDecoration(
                        color: Tema.grisClaro,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text('${m.tareas}', style: const TextStyle(fontSize: 10.5)),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 6),
              Expanded(
                child: GridView.builder(
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 7),
                  itemCount: (primerDiaSemana - 1) + diasEnMes,
                  itemBuilder: (_, i) {
                    final dia = i - (primerDiaSemana - 1) + 1;
                    if (dia < 1) return const SizedBox();
                    final esHoy = _anio == _hoy.year && m.mes == _hoy.month && dia == _hoy.day;
                    final tieneT = diasConTarea.contains(dia);
                    return Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            '$dia',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: tieneT || esHoy ? FontWeight.w700 : FontWeight.normal,
                              color: esHoy ? Tema.azul : (tieneT ? null : Tema.gris),
                            ),
                          ),
                          SizedBox(
                            height: 3,
                            child: tieneT
                                ? Container(
                                    width: 3,
                                    height: 3,
                                    decoration: const BoxDecoration(
                                      color: Tema.azul,
                                      shape: BoxShape.circle,
                                    ),
                                  )
                                : null,
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ---------- Vista de mes ----------

  Widget _vistaMes() {
    final diasEnMes = DateTime(_anio, _mes + 1, 0).day;
    final primerDiaSemana = DateTime(_anio, _mes, 1).weekday;
    final total = _dias.values.fold<int>(0, (s, l) => s + l.length);

    return ListView(
      padding: EdgeInsets.fromLTRB(10, 10, 10, 10 + margenSistema(context)),
      children: [
        if (total == 0)
          const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Text('Sin tareas programadas este mes.',
                style: TextStyle(color: Tema.gris, fontSize: 12.5)),
          ),
        Row(
          children: [
            for (final d in _diasSemanaCorto)
              Expanded(
                child: Center(
                  child: Text(d, style: const TextStyle(fontSize: 11.5, color: Tema.gris, fontWeight: FontWeight.w600)),
                ),
              ),
          ],
        ),
        const SizedBox(height: 4),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 7,
            childAspectRatio: 0.8,
            crossAxisSpacing: 2,
            mainAxisSpacing: 2,
          ),
          itemCount: (primerDiaSemana - 1) + diasEnMes,
          itemBuilder: (_, i) {
            final dia = i - (primerDiaSemana - 1) + 1;
            if (dia < 1) return const SizedBox();
            return _celdaDia(dia);
          },
        ),
      ],
    );
  }

  Widget _celdaDia(int dia) {
    final eventos = _dias[dia] ?? const <EventoCalendario>[];
    final esHoy = _anio == _hoy.year && _mes == _hoy.month && dia == _hoy.day;
    const maxPuntos = 4;

    return InkWell(
      onTap: () => _abrirDia(dia, eventos),
      borderRadius: BorderRadius.circular(6),
      child: Container(
        decoration: BoxDecoration(
          color: esHoy ? Tema.azul.withOpacity(0.08) : null,
          border: Border.all(color: Tema.grisClaro),
          borderRadius: BorderRadius.circular(6),
        ),
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.start,
          children: [
            Text(
              '$dia',
              style: TextStyle(
                fontSize: 12,
                fontWeight: esHoy ? FontWeight.w700 : FontWeight.w500,
                color: esHoy ? Tema.azul : null,
              ),
            ),
            const SizedBox(height: 2),
            if (eventos.isNotEmpty)
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 2,
                children: [
                  for (final e in eventos.take(maxPuntos))
                    Container(
                      width: 5,
                      height: 5,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: _colorEvento(e)),
                    ),
                  if (eventos.length > maxPuntos)
                    Text('+${eventos.length - maxPuntos}',
                        style: const TextStyle(fontSize: 8, color: Tema.gris)),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _abrirDia(int dia, List<EventoCalendario> eventos) async {
    // La hoja devuelve si se ha pedido programar. Se cierra antes de abrir el
    // formulario: encadenar una pantalla completa sobre una hoja que sigue ahí
    // deja la hoja debajo al volver.
    final programar = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _HojaDia(
        dia: dia,
        mes: _mes,
        anio: _anio,
        eventos: eventos,
        // La ruta que guarda tareas es «soloProgramador»: enseñarle el botón a
        // un técnico, que sí ve el calendario, sería ofrecerle algo que el
        // servidor le va a negar.
        puedeProgramar: SesionScope.de(context).meta?.puedeProgramar ?? false,
      ),
    );
    if (programar == true && mounted) await _programar(dia);
  }

  /// El formulario de siempre, ya puesto en el día que se ha pulsado.
  Future<void> _programar(int dia) async {
    final guardada = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FichaTarea(fechaInicial: DateTime(_anio, _mes, dia)),
      ),
    );
    // La tarea nueva puede caer en este mismo mes, así que se vuelve a pedir.
    if (guardada == true && mounted) await _cargar();
  }
}

/// La agenda de un día, en una hoja que sube desde abajo.
class _HojaDia extends StatelessWidget {
  const _HojaDia({
    required this.dia,
    required this.mes,
    required this.anio,
    required this.eventos,
    required this.puedeProgramar,
  });

  final int dia;
  final int mes;
  final int anio;
  final List<EventoCalendario> eventos;
  final bool puedeProgramar;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.of(context).viewPadding.bottom + 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$dia de ${_mesesLargo[mes - 1]}, $anio',
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
          const SizedBox(height: 12),
          if (eventos.isEmpty)
            const Text('Sin tareas programadas este día.',
                style: TextStyle(color: Tema.gris, fontSize: 13.5))
          else
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: eventos.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (_, i) => _tarjetaEvento(eventos[i]),
              ),
            ),
          if (puedeProgramar) ...[
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: () => Navigator.pop(context, true),
                icon: const Icon(Icons.add),
                label: const Text('Programar una tarea este día'),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _tarjetaEvento(EventoCalendario e) {
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text('${e.hora} — ${e.nombre}',
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                ),
                Distintivo(texto: _textoEstado(e.estado), color: _colorEvento(e)),
              ],
            ),
            Text(e.plantillaTitulo, style: const TextStyle(fontSize: 12.5, color: Tema.gris)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (e.areaNombre != null) Distintivo(texto: e.areaNombre!, color: Tema.gris),
                if (e.familiaNombre != null) Distintivo(texto: e.familiaNombre!, color: Tema.gris),
                if (e.localNombre != null) Distintivo(texto: e.localNombre!, color: Tema.gris),
                Distintivo(
                  texto: e.mantenimientoExterno ? (e.empresaNombre ?? 'Externo') : 'Propio personal',
                  color: e.mantenimientoExterno ? Tema.ambar : Tema.gris,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Los filtros del calendario, en una hoja que sube desde abajo.
class _HojaFiltrosCalendario extends StatefulWidget {
  const _HojaFiltrosCalendario({
    required this.meta,
    required this.areaId,
    required this.familiaId,
    required this.empresaId,
    required this.externo,
    required this.alAplicar,
  });

  final Meta? meta;
  final int? areaId;
  final int? familiaId;
  final int? empresaId;
  final bool? externo;

  final void Function({int? areaId, int? familiaId, int? empresaId, bool? externo}) alAplicar;

  @override
  State<_HojaFiltrosCalendario> createState() => _HojaFiltrosCalendarioState();
}

class _HojaFiltrosCalendarioState extends State<_HojaFiltrosCalendario> {
  late int? _areaId = widget.areaId;
  late int? _familiaId = widget.familiaId;
  late int? _empresaId = widget.empresaId;
  late bool? _externo = widget.externo;

  @override
  Widget build(BuildContext context) {
    final meta = widget.meta;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16, 0, 16,
        MediaQuery.of(context).viewInsets.bottom + MediaQuery.of(context).viewPadding.bottom + 24,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Filtros', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
            const SizedBox(height: 16),
            DropdownButtonFormField<int>(
              value: _areaId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Grupo', isDense: true),
              items: [
                const DropdownMenuItem(value: null, child: Text('Todos')),
                for (final a in meta?.areas ?? const <Catalogo>[])
                  DropdownMenuItem(value: a.id, child: Text(a.nombre)),
              ],
              onChanged: (v) => setState(() {
                _areaId = v;
                _familiaId = null;
              }),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              value: _familiaId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Familia', isDense: true),
              items: [
                const DropdownMenuItem(value: null, child: Text('Todas')),
                for (final f in (meta?.familias ?? const <Familia>[])
                    .where((f) => _areaId == null || f.areaId == _areaId))
                  DropdownMenuItem(value: f.id, child: Text(f.nombre)),
              ],
              onChanged: (v) => setState(() => _familiaId = v),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<bool?>(
              value: _externo,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Mantenimiento', isDense: true),
              items: const [
                DropdownMenuItem(value: null, child: Text('Todos')),
                DropdownMenuItem(value: true, child: Text('Externo')),
                DropdownMenuItem(value: false, child: Text('Propio personal')),
              ],
              onChanged: (v) => setState(() => _externo = v),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              value: _empresaId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Empresa', isDense: true),
              items: [
                const DropdownMenuItem(value: null, child: Text('Todas')),
                for (final e in meta?.empresas ?? const <Catalogo>[])
                  DropdownMenuItem(value: e.id, child: Text(e.nombre)),
              ],
              onChanged: (v) => setState(() => _empresaId = v),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      widget.alAplicar();
                      Navigator.pop(context);
                    },
                    child: const Text('Limpiar'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: () {
                      widget.alAplicar(
                        areaId: _areaId, familiaId: _familiaId, empresaId: _empresaId, externo: _externo,
                      );
                      Navigator.pop(context);
                    },
                    child: const Text('Aplicar'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
