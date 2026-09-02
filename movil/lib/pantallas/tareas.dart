import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/formato.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';

const _frecuencias = {
  'una_vez': 'Una vez',
  'diaria': 'Diaria',
  'semanal': 'Semanal',
  'mensual': 'Mensual',
};

// Domingo es 0, como en la base.
const _diasSemana = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const _nombresMes = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

/// El programador de tareas: incidencias que se abren solas cada cierto tiempo.
/// Lo llevan el gestor y el administrador.
class Tareas extends StatefulWidget {
  const Tareas({super.key});

  @override
  State<Tareas> createState() => _TareasState();
}

class _TareasState extends State<Tareas> {
  List<Tarea> _tareas = [];
  bool _cargando = true;
  String? _error;
  bool _iniciado = false;

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
      final datos = await SesionScope.de(context).api.get('/api/tareas') as List;
      if (!mounted) return;
      setState(() {
        _tareas = datos
            .map((e) => Tarea.desdeJson(e as Map<String, dynamic>))
            .toList();
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

  Future<void> _abrirFicha({Tarea? tarea}) async {
    final guardada = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => FichaTarea(tarea: tarea)),
    );
    if (guardada == true) _cargar();
  }

  Future<void> _ejecutar(Tarea t) async {
    try {
      await SesionScope.de(context).api.post('/api/tareas/${t.id}/ejecutar');
      _avisar('Tarea lanzada. Mira la lista de incidencias.');
      _cargar();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _borrar(Tarea t) async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: Text('Eliminar ${t.nombre}'),
        content: Text(
          t.tickets > 0
              ? 'Ha abierto ${t.tickets} incidencia(s), que se conservan. '
                  'La tarea dejará de saltar.'
              : 'La tarea dejará de saltar.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogo, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Tema.rojo),
            onPressed: () => Navigator.pop(dialogo, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (seguro != true || !mounted) return;

    try {
      await SesionScope.de(context).api.delete('/api/tareas/${t.id}');
      _cargar();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  void _avisar(String texto, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(texto),
      backgroundColor: error ? Tema.rojo : null,
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tareas programadas')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _abrirFicha(),
        icon: const Icon(Icons.add),
        label: const Text('Nueva'),
      ),
      body: RefreshIndicator(
        onRefresh: _cargar,
        child: _cargando && _tareas.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _tareas.isEmpty
                ? ListView(children: [
                    const SizedBox(height: 80),
                    Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar),
                  ])
                : _tareas.isEmpty
                    ? ListView(children: const [
                        SizedBox(height: 80),
                        Aviso(
                          icono: Icons.schedule,
                          texto: 'No hay ninguna tarea programada.',
                        ),
                      ])
                    : ListView.separated(
                        padding: EdgeInsets.fromLTRB(12, 12, 12, 90 + margenSistema(context)),
                        itemCount: _tareas.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => _fila(_tareas[i]),
                      ),
      ),
    );
  }

  Widget _fila(Tarea t) {
    return Tarjeta(
      child: InkWell(
        onTap: () => _abrirFicha(tarea: t),
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      t.nombre,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: t.activo ? null : Tema.gris,
                      ),
                    ),
                  ),
                  if (!t.activo)
                    const Distintivo(texto: 'Parada', color: Tema.gris),
                ],
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  Distintivo(
                    texto: _frecuencias[t.frecuencia] ?? t.frecuencia,
                    color: Tema.azul,
                  ),
                  DistintivoPrioridad(t.prioridad),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                '${t.grupoNombre} · ${t.localNombre ?? 'Todos los locales'}',
                style: const TextStyle(fontSize: 12.5, color: Tema.gris),
              ),
              if (t.areaNombre != null) ...[
                const SizedBox(height: 3),
                Text(
                  t.familiaNombre != null ? '${t.areaNombre} · ${t.familiaNombre}' : t.areaNombre!,
                  style: const TextStyle(fontSize: 12.5, color: Tema.gris),
                ),
              ],
              if (t.mantenimientoExterno) ...[
                const SizedBox(height: 3),
                Text(
                  'Mantenimiento externo · ${t.empresaNombre ?? 'Sin empresa'}',
                  style: const TextStyle(fontSize: 12.5, color: Tema.gris),
                ),
              ],
              const SizedBox(height: 3),
              // Sin esto, una tarea puesta a una hora que ya pasó parece
              // estropeada hasta el día siguiente.
              Text(
                t.activo
                    ? (t.proximaTexto == null
                        ? 'No volverá a saltar'
                        : 'Próxima: ${t.proximaTexto}')
                    : 'Parada',
                style: TextStyle(
                  fontSize: 12.5,
                  color: t.activo && t.proximaTexto != null ? Tema.verde : Tema.gris,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (t.tickets > 0) ...[
                const SizedBox(height: 3),
                Text('${t.tickets} incidencia(s) abiertas',
                    style: const TextStyle(fontSize: 12, color: Tema.gris)),
              ],
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton.icon(
                    onPressed: () => _ejecutar(t),
                    icon: const Icon(Icons.play_arrow, size: 16),
                    label: const Text('Ejecutar ahora', style: TextStyle(fontSize: 12.5)),
                  ),
                  TextButton.icon(
                    onPressed: () => _borrar(t),
                    icon: const Icon(Icons.delete_outline, size: 16, color: Tema.rojo),
                    label: const Text('Eliminar',
                        style: TextStyle(fontSize: 12.5, color: Tema.rojo)),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// El formulario de una tarea, con las mismas cuatro pautas que la web.
class FichaTarea extends StatefulWidget {
  const FichaTarea({super.key, this.tarea, this.fechaInicial});

  final Tarea? tarea;

  /// El día con el que llega el formulario ya puesto, viniendo del calendario.
  ///
  /// Además de la fecha, cambia la pauta por defecto a «una vez»: se ha pulsado
  /// un día concreto, no «cada lunes». Se puede cambiar antes de guardar. Al
  /// editar una tarea no se usa: manda la fecha que ya tenía.
  final DateTime? fechaInicial;

  @override
  State<FichaTarea> createState() => _FichaTareaState();
}

class _FichaTareaState extends State<FichaTarea> {
  final _formulario = GlobalKey<FormState>();
  late final _nombre = TextEditingController(text: widget.tarea?.nombre ?? '');
  late final _titulo =
      TextEditingController(text: widget.tarea?.plantillaTitulo ?? '');
  late final _descripcion =
      TextEditingController(text: widget.tarea?.plantillaDescripcion ?? '');

  late String _frecuencia =
      widget.tarea?.frecuencia ?? (widget.fechaInicial != null ? 'una_vez' : 'diaria');
  late int _cada = widget.tarea?.cada ?? 1;
  late TimeOfDay _hora = _horaDe(widget.tarea?.hora);
  late DateTime _inicio = widget.fechaInicial ?? _fechaDe(widget.tarea?.fechaInicio);
  late Set<int> _dias = _numeros(widget.tarea?.diasSemana);
  late Set<int> _diasMes = _numeros(widget.tarea?.diasMes);
  late Set<int> _meses = _numeros(widget.tarea?.meses);
  late int? _grupoId = widget.tarea?.grupoId;
  late int? _localId = widget.tarea?.localId;
  late String _prioridad = widget.tarea?.prioridad ?? 'normal';
  late bool _activo = widget.tarea?.activo ?? true;
  late bool _mantenimientoExterno = widget.tarea?.mantenimientoExterno ?? false;
  late int? _empresaId = widget.tarea?.empresaId;
  late int? _areaId = widget.tarea?.areaId;
  late int? _familiaId = widget.tarea?.familiaId;

  bool _enviando = false;
  String? _error;

  bool get _esAlta => widget.tarea == null;

  static TimeOfDay _horaDe(String? v) {
    final partes = (v ?? '09:00').split(':');
    return TimeOfDay(
      hour: int.tryParse(partes.first) ?? 9,
      minute: partes.length > 1 ? (int.tryParse(partes[1]) ?? 0) : 0,
    );
  }

  static DateTime _fechaDe(String? v) =>
      DateTime.tryParse(v ?? '') ?? DateTime.now();

  static Set<int> _numeros(String? v) => (v ?? '')
      .split(',')
      .map((e) => int.tryParse(e.trim()))
      .whereType<int>()
      .toSet();

  @override
  void dispose() {
    _nombre.dispose();
    _titulo.dispose();
    _descripcion.dispose();
    super.dispose();
  }

  String get _horaTexto =>
      '${_hora.hour.toString().padLeft(2, '0')}:${_hora.minute.toString().padLeft(2, '0')}';

  Future<void> _guardar() async {
    if (!_formulario.currentState!.validate()) return;

    if (_grupoId == null) {
      setState(() => _error = 'El grupo es obligatorio.');
      return;
    }
    if (_frecuencia == 'semanal' && _dias.isEmpty) {
      setState(() => _error = 'Elige al menos un día de la semana.');
      return;
    }
    if (_frecuencia == 'mensual' && _diasMes.isEmpty) {
      setState(() => _error = 'Elige al menos un día del mes.');
      return;
    }
    if (_mantenimientoExterno && _empresaId == null) {
      setState(() => _error = 'La empresa es obligatoria en el mantenimiento externo.');
      return;
    }

    setState(() {
      _enviando = true;
      _error = null;
    });

    final cuerpo = {
      'nombre': _nombre.text.trim(),
      'frecuencia': _frecuencia,
      'hora': _horaTexto,
      'fecha_inicio': DateFormat('yyyy-MM-dd').format(_inicio),
      'cada': _cada,
      // Cada pauta manda solo lo suyo; lo demás va nulo, como en la web.
      'dias_semana': _frecuencia == 'semanal' ? (_dias.toList()..sort()).join(',') : null,
      'dias_mes': _frecuencia == 'mensual' ? (_diasMes.toList()..sort()).join(',') : null,
      // Los doce meses marcados equivale a no filtrar por mes.
      'meses': _frecuencia == 'mensual' && _meses.isNotEmpty && _meses.length < 12
          ? (_meses.toList()..sort()).join(',')
          : null,
      'plantilla_titulo': _titulo.text.trim(),
      'plantilla_descripcion': _descripcion.text.trim(),
      'grupo_id': _grupoId,
      'local_id': _localId,
      'prioridad': _prioridad,
      'activo': _activo,
      'mantenimiento_externo': _mantenimientoExterno,
      'empresa_id': _mantenimientoExterno ? _empresaId : null,
      'area_id': _areaId,
      'familia_id': _familiaId,
    };

    try {
      final api = SesionScope.de(context).api;
      if (_esAlta) {
        await api.post('/api/tareas', cuerpo);
      } else {
        await api.put('/api/tareas/${widget.tarea!.id}', cuerpo);
      }
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

    return Scaffold(
      appBar: AppBar(title: Text(_esAlta ? 'Nueva tarea' : widget.tarea!.nombre)),
      body: Form(
        key: _formulario,
        child: ListView(
          padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + margenSistema(context)),
          children: [
            TextFormField(
              controller: _nombre,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Nombre de la tarea',
                helperText: 'Aparece como quien abre la incidencia',
              ),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'El nombre es obligatorio.' : null,
            ),
            const SizedBox(height: 20),
            const Text('Cuándo se repite',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              value: _frecuencia,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Frecuencia'),
              items: [
                for (final f in _frecuencias.entries)
                  DropdownMenuItem(value: f.key, child: Text(f.value)),
              ],
              onChanged: (v) => setState(() => _frecuencia = v ?? 'diaria'),
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () async {
                      final elegida = await showDatePicker(
                        context: context,
                        initialDate: _inicio,
                        firstDate: DateTime(2020),
                        lastDate: DateTime(DateTime.now().year + 5, 12, 31),
                      );
                      if (elegida != null) setState(() => _inicio = elegida);
                    },
                    child: InputDecorator(
                      decoration: const InputDecoration(labelText: 'Empieza el'),
                      child: Text(DateFormat('d MMM y', 'es').format(_inicio)),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: InkWell(
                    onTap: () async {
                      final elegida =
                          await showTimePicker(context: context, initialTime: _hora);
                      if (elegida != null) setState(() => _hora = elegida);
                    },
                    child: InputDecorator(
                      decoration: const InputDecoration(labelText: 'A las'),
                      child: Text(_horaTexto),
                    ),
                  ),
                ),
              ],
            ),
            if (_frecuencia == 'diaria' || _frecuencia == 'semanal') ...[
              const SizedBox(height: 14),
              TextFormField(
                initialValue: '$_cada',
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: _frecuencia == 'diaria'
                      ? 'Cada cuántos días'
                      : 'Cada cuántas semanas',
                ),
                onChanged: (v) => _cada = int.tryParse(v) ?? 1,
              ),
            ],
            if (_frecuencia == 'semanal') ...[
              const SizedBox(height: 14),
              const Text('Qué días', style: TextStyle(fontSize: 13, color: Tema.gris)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                children: [
                  for (var d = 0; d < 7; d += 1)
                    FilterChip(
                      label: Text(_diasSemana[d]),
                      selected: _dias.contains(d),
                      onSelected: (marcado) => setState(() {
                        if (marcado) {
                          _dias.add(d);
                        } else {
                          _dias.remove(d);
                        }
                      }),
                    ),
                ],
              ),
            ],
            if (_frecuencia == 'mensual') ...[
              const SizedBox(height: 14),
              const Text('Qué días del mes',
                  style: TextStyle(fontSize: 13, color: Tema.gris)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 4,
                runSpacing: 4,
                children: [
                  for (var d = 1; d <= 31; d += 1)
                    FilterChip(
                      label: Text('$d', style: const TextStyle(fontSize: 12)),
                      selected: _diasMes.contains(d),
                      onSelected: (marcado) => setState(() {
                        if (marcado) {
                          _diasMes.add(d);
                        } else {
                          _diasMes.remove(d);
                        }
                      }),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              const Text(
                'Un día que no existe en un mes no salta: el 31 no se adelanta al 28 de febrero.',
                style: TextStyle(fontSize: 11.5, color: Tema.gris),
              ),
              const SizedBox(height: 14),
              const Text('En qué meses (ninguno = todos)',
                  style: TextStyle(fontSize: 13, color: Tema.gris)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 4,
                runSpacing: 4,
                children: [
                  for (var m = 1; m <= 12; m += 1)
                    FilterChip(
                      label: Text(_nombresMes[m - 1], style: const TextStyle(fontSize: 12)),
                      selected: _meses.contains(m),
                      onSelected: (marcado) => setState(() {
                        if (marcado) {
                          _meses.add(m);
                        } else {
                          _meses.remove(m);
                        }
                      }),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 24),
            const Text('Qué incidencia abre',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            TextFormField(
              controller: _titulo,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Título de la incidencia'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'El título es obligatorio.' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _descripcion,
              minLines: 2,
              maxLines: 5,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Descripción',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<int>(
              value: _grupoId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Departamento'),
              items: [
                for (final g in meta?.grupos ?? const <Catalogo>[])
                  DropdownMenuItem(value: g.id, child: Text(g.nombre)),
              ],
              onChanged: (v) => setState(() => _grupoId = v),
              validator: (v) => v == null ? 'Elige el departamento.' : null,
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<int>(
              value: _localId,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Local',
                helperText: 'Sin local, abre una incidencia por cada local',
              ),
              items: [
                const DropdownMenuItem(value: null, child: Text('Todos los locales')),
                for (final l in meta?.locales ?? const <Catalogo>[])
                  DropdownMenuItem(value: l.id, child: Text(l.nombre)),
              ],
              onChanged: (v) => setState(() => _localId = v),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<int>(
              value: _areaId,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Grupo (opcional)',
                helperText: 'El equipo que mantiene, para que salga en el calendario',
              ),
              items: [
                const DropdownMenuItem(value: null, child: Text('Sin grupo')),
                for (final a in meta?.areas ?? const <Catalogo>[])
                  DropdownMenuItem(value: a.id, child: Text(a.nombre)),
              ],
              // La familia elegida era del grupo anterior: se limpia con él.
              onChanged: (v) => setState(() {
                _areaId = v;
                _familiaId = null;
              }),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<int>(
              value: _familiaId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Familia (opcional)'),
              items: [
                const DropdownMenuItem(value: null, child: Text('Sin familia')),
                for (final f in (meta?.familias ?? const <Familia>[])
                    .where((f) => _areaId == null || f.areaId == _areaId))
                  DropdownMenuItem(value: f.id, child: Text(f.nombre)),
              ],
              onChanged: _areaId == null ? null : (v) => setState(() => _familiaId = v),
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Mantenimiento externo', style: TextStyle(fontSize: 14)),
              subtitle: const Text(
                'La atiende una empresa con contrato, no el propio personal',
                style: TextStyle(fontSize: 12, color: Tema.gris),
              ),
              value: _mantenimientoExterno,
              onChanged: (v) => setState(() => _mantenimientoExterno = v),
            ),
            if (_mantenimientoExterno) ...[
              const SizedBox(height: 6),
              DropdownButtonFormField<int>(
                value: _empresaId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Empresa'),
                items: [
                  for (final e in meta?.empresas ?? const <Catalogo>[])
                    DropdownMenuItem(value: e.id, child: Text(e.nombre)),
                ],
                onChanged: (v) => setState(() => _empresaId = v),
                validator: (v) =>
                    _mantenimientoExterno && v == null ? 'Elige la empresa.' : null,
              ),
            ],
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              value: _prioridad,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Prioridad'),
              items: [
                for (final p in etiquetasPrioridad.entries)
                  DropdownMenuItem(value: p.key, child: Text(p.value)),
              ],
              onChanged: (v) => setState(() => _prioridad = v ?? 'normal'),
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Activa', style: TextStyle(fontSize: 14)),
              subtitle: const Text('Una tarea parada no salta',
                  style: TextStyle(fontSize: 12, color: Tema.gris)),
              value: _activo,
              onChanged: (v) => setState(() => _activo = v),
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
      ),
    );
  }
}
