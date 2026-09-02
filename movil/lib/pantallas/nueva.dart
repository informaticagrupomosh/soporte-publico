import 'package:flutter/material.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/formato.dart';
import '../nucleo/tema.dart';
import '../widgets/adjuntos.dart';
import '../widgets/etiquetas.dart';

/// Abrir una incidencia. Los locales son solo los del usuario: el servidor lo
/// exige y aquí ni siquiera se ofrecen los demás.
class NuevaIncidencia extends StatefulWidget {
  const NuevaIncidencia({super.key});

  @override
  State<NuevaIncidencia> createState() => _NuevaIncidenciaState();
}

class _NuevaIncidenciaState extends State<NuevaIncidencia> {
  final _formulario = GlobalKey<FormState>();
  final _titulo = TextEditingController();
  final _descripcion = TextEditingController();

  int? _grupoId;
  int? _localId;

  /// El grupo y la familia de la avería, obligatorios. La familia depende del
  /// grupo elegido y la subfamilia de la familia elegida, así que se limpian
  /// en cadena si dejan de pertenecerle.
  int? _areaId;
  int? _familiaId;
  int? _subfamiliaId;

  /// El activo del inventario que señala la incidencia, opcional. Depende del
  /// departamento elegido, así que se limpia si deja de pertenecerle.
  int? _activoId;

  /// A nombre de quién va la incidencia. Nulo quiere decir «a mi nombre».
  int? _enNombreDe;
  String _prioridad = 'normal';
  bool _enviando = false;
  String? _error;

  /// Fotos y archivos ya subidos. La incidencia no se crea hasta que están
  /// enteros en el servidor, así que aquí ya lo están.
  final List<Borrador> _borradores = [];

  bool _iniciado = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    // Con un solo local no hay nada que elegir: se deja puesto.
    final propios = SesionScope.de(context).meta?.localesPropios ?? const <Catalogo>[];
    if (propios.length == 1) _localId = propios.first.id;
  }

  @override
  void dispose() {
    _titulo.dispose();
    _descripcion.dispose();
    super.dispose();
  }

  Future<void> _crear() async {
    if (!_formulario.currentState!.validate()) return;

    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      await SesionScope.de(context).api.post('/api/tickets', {
        'titulo': _titulo.text.trim(),
        'descripcion': _descripcion.text.trim(),
        'grupo_id': _grupoId,
        'local_id': _localId,
        'area_id': _areaId,
        'familia_id': _familiaId,
        if (_subfamiliaId != null) 'subfamilia_id': _subfamiliaId,
        if (_activoId != null) 'activo_id': _activoId,
        'prioridad': _prioridad,
        if (_enNombreDe != null) 'en_nombre_de': _enNombreDe,
        // La descripción y estos adjuntos serán el primer mensaje del hilo.
        'adjuntos': _borradores.map((b) => b.id).toList(),
      });
      if (!mounted) return;
      // El servidor ya ha avisado por push a los técnicos que la atienden.
      Navigator.pop(context, true);
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
    final grupos = meta?.grupos ?? const <Catalogo>[];
    final areas = meta?.areas ?? const <Catalogo>[];
    final familias = (meta?.familias ?? const <Familia>[])
        .where((f) => f.areaId == _areaId)
        .toList();
    final subfamilias = (meta?.subfamilias ?? const <Subfamilia>[])
        .where((s) => s.familiaId == _familiaId)
        .toList();
    // El activo está en un local concreto, así que hace falta el
    // departamento y el local para ofrecer alguno.
    final activos = (meta?.activos ?? const <ActivoResumen>[])
        .where((a) => a.grupoId == _grupoId && a.localId == _localId)
        .toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Nueva incidencia')),
      body: locales.isEmpty
          ? const Aviso(
              icono: Icons.storefront_outlined,
              texto: 'No tienes ningún local asignado, así que no puedes abrir '
                  'incidencias. Habla con un administrador.',
            )
          : Form(
              key: _formulario,
              child: ListView(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + margenSistema(context)),
                children: [
                  TextFormField(
                    controller: _titulo,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Título',
                      hintText: 'Qué ha pasado, en una línea',
                    ),
                    validator: (v) =>
                        (v == null || v.trim().isEmpty) ? 'El título es obligatorio.' : null,
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<int>(
                    value: _grupoId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Departamento',
                      helperText: 'Quién tiene que arreglarlo',
                    ),
                    items: [
                      for (final g in grupos)
                        DropdownMenuItem(value: g.id, child: Text(g.nombre)),
                    ],
                    // El activo elegido era del departamento anterior: deja de
                    // pertenecerle, así que se limpia con él.
                    onChanged: (v) => setState(() {
                      _grupoId = v;
                      _activoId = null;
                    }),
                    validator: (v) => v == null ? 'Elige el departamento.' : null,
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<int>(
                    value: _localId,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Local'),
                    items: [
                      for (final l in locales)
                        DropdownMenuItem(value: l.id, child: Text(l.nombre)),
                    ],
                    // El activo elegido era del local anterior: deja de
                    // pertenecerle, así que se limpia con él.
                    onChanged: (v) => setState(() {
                      _localId = v;
                      _activoId = null;
                    }),
                    validator: (v) => v == null ? 'Elige el local.' : null,
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<int>(
                    value: _areaId,
                    isExpanded: true,
                    decoration: const InputDecoration(labelText: 'Grupo'),
                    items: [
                      for (final a in areas)
                        DropdownMenuItem(value: a.id, child: Text(a.nombre)),
                    ],
                    // La familia y la subfamilia elegidas eran del grupo
                    // anterior: dejan de pertenecerle, así que se limpian con él.
                    onChanged: (v) => setState(() {
                      _areaId = v;
                      _familiaId = null;
                      _subfamiliaId = null;
                    }),
                    validator: (v) => v == null ? 'Elige el grupo.' : null,
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<int>(
                    value: _familiaId,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: 'Familia',
                      helperText: _areaId == null ? 'Elige antes un grupo' : null,
                    ),
                    items: [
                      for (final f in familias)
                        DropdownMenuItem(value: f.id, child: Text(f.nombre)),
                    ],
                    // La subfamilia elegida era de la familia anterior: deja de
                    // pertenecerle, así que se limpia con ella.
                    onChanged: _areaId == null
                        ? null
                        : (v) => setState(() {
                              _familiaId = v;
                              _subfamiliaId = null;
                            }),
                    validator: (v) => v == null ? 'Elige la familia.' : null,
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<int>(
                    value: _subfamiliaId,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: 'Subfamilia (opcional)',
                      helperText: _familiaId == null ? 'Elige antes una familia' : null,
                    ),
                    items: [
                      const DropdownMenuItem(value: null, child: Text('Sin subfamilia')),
                      for (final s in subfamilias)
                        DropdownMenuItem(value: s.id, child: Text(s.nombre)),
                    ],
                    onChanged: _familiaId == null
                        ? null
                        : (v) => setState(() => _subfamiliaId = v),
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<int>(
                    value: _activoId,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: 'Activo del inventario (opcional)',
                      helperText: _grupoId == null
                          ? 'Elige antes un departamento'
                          : (_localId == null ? 'Elige antes un local' : null),
                    ),
                    items: [
                      const DropdownMenuItem(value: null, child: Text('Sin activo')),
                      for (final a in activos)
                        DropdownMenuItem(value: a.id, child: Text(a.nombre)),
                    ],
                    onChanged: (_grupoId == null || _localId == null)
                        ? null
                        : (v) => setState(() => _activoId = v),
                  ),
                  const SizedBox(height: 18),
                  const Text('Prioridad',
                      style: TextStyle(fontSize: 13, color: Tema.gris)),
                  const SizedBox(height: 8),
                  SegmentedButton<String>(
                    segments: [
                      for (final p in etiquetasPrioridad.entries)
                        ButtonSegment(
                          value: p.key,
                          label: Text(
                            // «Cuando se pueda» no cabe en un segmento.
                            p.key == 'cuando_se_pueda' ? 'Sin prisa' : p.value,
                            style: const TextStyle(fontSize: 12.5),
                          ),
                        ),
                    ],
                    selected: {_prioridad},
                    showSelectedIcon: false,
                    onSelectionChanged: (s) => setState(() => _prioridad = s.first),
                  ),
                  const SizedBox(height: 18),
                  TextFormField(
                    controller: _descripcion,
                    minLines: 4,
                    maxLines: 8,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: const InputDecoration(
                      labelText: 'Descripción',
                      alignLabelWithHint: true,
                      hintText: 'Detalles que ayuden a resolverlo',
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    Text(_error!, style: const TextStyle(color: Tema.rojo, fontSize: 13.5)),
                  ],
                  // Para cuando alguien cuenta una avería de palabra y la
                  // abre el técnico: queda a nombre de quien la reporta, así que
                  // los avisos y el hilo le llegan a él.
                  if (meta?.puedeAbrirEnNombreDe ?? false) ...[
                    const SizedBox(height: 14),
                    DropdownButtonFormField<int>(
                      value: _enNombreDe,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'A nombre de',
                        helperText: 'En blanco, va a tu nombre',
                      ),
                      items: [
                        const DropdownMenuItem(value: null, child: Text('A mi nombre')),
                        for (final p in meta?.enNombreDe ?? const <Catalogo>[])
                          DropdownMenuItem(value: p.id, child: Text(p.nombre)),
                      ],
                      onChanged: (v) => setState(() => _enNombreDe = v),
                    ),
                  ],
                  const SizedBox(height: 18),
                  const Text('Adjuntos',
                      style: TextStyle(fontSize: 13, color: Tema.gris)),
                  const SizedBox(height: 6),
                  TiraBorradores(
                    borradores: _borradores,
                    alQuitar: (b) {
                      setState(() => _borradores.remove(b));
                      SesionScope.de(context).api.descartarBorrador(b.id);
                    },
                  ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: BotonAdjuntar(
                      alSubir: (b) => setState(() => _borradores.add(b)),
                    ),
                  ),
                  const SizedBox(height: 18),
                  FilledButton(
                    onPressed: _enviando ? null : _crear,
                    child: _enviando
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('Abrir incidencia'),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'La descripción y los adjuntos serán el primer mensaje de la '
                    'conversación.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12, color: Tema.gris),
                  ),
                ],
              ),
            ),
    );
  }
}
