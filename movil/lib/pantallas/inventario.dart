import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';

const _estadosActivo = {
  'en_uso': 'En uso',
  'roto': 'Roto',
  'almacen': 'Guardado en almacén',
};

Color _colorEstadoActivo(String estado) {
  switch (estado) {
    case 'roto':
      return Tema.rojo;
    case 'almacen':
      return Tema.gris;
    default:
      return Tema.verde;
  }
}

/// El equipamiento del local (una batidora, un televisor…), para poder
/// enlazarlo desde la incidencia que lo señale. Lo llevan quienes gestionan
/// incidencias: técnico, gestor y administrador.
class Inventario extends StatefulWidget {
  const Inventario({super.key});

  @override
  State<Inventario> createState() => _InventarioState();
}

class _InventarioState extends State<Inventario> {
  List<Activo> _activos = [];
  bool _cargando = true;
  String? _error;
  bool _iniciado = false;

  int? _grupoId;
  int? _localId;
  String? _estado;

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
      final datos = await api.get('/api/activos', {
        'grupo_id': _grupoId,
        'local_id': _localId,
        'estado': _estado,
      }) as List;
      if (!mounted) return;
      setState(() {
        _activos = datos.map((e) => Activo.desdeJson(e as Map<String, dynamic>)).toList();
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
      MaterialPageRoute(builder: (_) => const EditarActivo()),
    );
    if (creado == true) _cargar();
  }

  Future<void> _abrir(Activo a) async {
    final cambiado = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => FichaActivo(activoId: a.id)),
    );
    if (cambiado == true) _cargar();
  }

  @override
  Widget build(BuildContext context) {
    final meta = SesionScope.de(context).meta;

    return Scaffold(
      appBar: AppBar(title: const Text('Inventario')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _nuevo,
        icon: const Icon(Icons.add),
        label: const Text('Agregar activo'),
      ),
      body: RefreshIndicator(
        onRefresh: _cargar,
        child: ListView(
          padding: EdgeInsets.fromLTRB(12, 12, 12, 90 + margenSistema(context)),
          children: [
            _filtros(meta),
            const SizedBox(height: 8),
            if (_cargando && _activos.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null && _activos.isEmpty)
              Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar)
            else if (_activos.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 40),
                child: Aviso(
                  icono: Icons.inventory_2_outlined,
                  texto: 'Sin activos todavía. Agrega uno con el botón de abajo.',
                ),
              )
            else
              for (final a in _activos) _tarjeta(a),
          ],
        ),
      ),
    );
  }

  Widget _filtros(Meta? meta) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<int>(
                value: _grupoId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Departamento', isDense: true),
                items: [
                  const DropdownMenuItem(value: null, child: Text('Todos')),
                  for (final g in meta?.grupos ?? const <Catalogo>[])
                    DropdownMenuItem(value: g.id, child: Text(g.nombre)),
                ],
                onChanged: (v) {
                  setState(() => _grupoId = v);
                  _cargar();
                },
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: DropdownButtonFormField<int>(
                value: _localId,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Local', isDense: true),
                items: [
                  const DropdownMenuItem(value: null, child: Text('Todos')),
                  for (final l in meta?.locales ?? const <Catalogo>[])
                    DropdownMenuItem(value: l.id, child: Text(l.nombre)),
                ],
                onChanged: (v) {
                  setState(() => _localId = v);
                  _cargar();
                },
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        DropdownButtonFormField<String>(
          value: _estado,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Estado', isDense: true),
          items: [
            const DropdownMenuItem(value: null, child: Text('Todos')),
            for (final e in _estadosActivo.entries) DropdownMenuItem(value: e.key, child: Text(e.value)),
          ],
          onChanged: (v) {
            setState(() => _estado = v);
            _cargar();
          },
        ),
      ],
    );
  }

  Widget _tarjeta(Activo a) {
    final api = SesionScope.de(context).api;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Tarjeta(
        child: ListTile(
          onTap: () => _abrir(a),
          leading: ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: a.foto != null
                ? Image.network(
                    api.urlFotoActivo(a.id).toString(),
                    headers: api.cabecerasAdjunto,
                    width: 44,
                    height: 44,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => _sinFoto(),
                  )
                : _sinFoto(),
          ),
          title: Text(a.nombre, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
          subtitle: Text('${a.grupoNombre} · ${a.localNombre}', style: const TextStyle(fontSize: 12.5)),
          trailing: Distintivo(texto: _estadosActivo[a.estado] ?? a.estado, color: _colorEstadoActivo(a.estado)),
        ),
      ),
    );
  }

  Widget _sinFoto() => Container(
        width: 44,
        height: 44,
        color: Tema.grisClaro,
        child: const Icon(Icons.inventory_2_outlined, color: Tema.gris, size: 20),
      );
}

/// La ficha de un activo: su foto, sus datos y el historial de incidencias
/// que lo han señalado, calculado al vuelo por el servidor (no se guarda
/// aparte, igual que la merma de lavandería).
class FichaActivo extends StatefulWidget {
  const FichaActivo({super.key, required this.activoId});

  final int activoId;

  @override
  State<FichaActivo> createState() => _FichaActivoState();
}

class _FichaActivoState extends State<FichaActivo> {
  Activo? _activo;
  bool _cargando = true;
  String? _error;
  bool _cambiado = false;

  @override
  void initState() {
    super.initState();
    // La carga no puede arrancar aquí mismo: lo primero que hace es pedir la
    // sesión, y pedirla desde `initState` es justo lo que Flutter no deja —el
    // widget todavía no está enganchado a lo que hereda—. La excepción no la
    // recogía nadie y la ficha se quedaba cargando para siempre. Con el primer
    // fotograma pintado, el contexto ya sirve.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _cargar();
    });
  }

  Future<void> _cargar() async {
    setState(() => _cargando = true);
    try {
      final datos = await SesionScope.de(context).api.get('/api/activos/${widget.activoId}');
      if (!mounted) return;
      setState(() {
        _activo = Activo.desdeJson(datos as Map<String, dynamic>);
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

  Future<void> _editar() async {
    final guardado = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => EditarActivo(activo: _activo)),
    );
    if (guardado == true) {
      _cambiado = true;
      _cargar();
    }
  }

  Future<void> _eliminar() async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: Text('Eliminar ${_activo!.nombre}'),
        content: const Text('¿Seguro que quieres eliminar este activo?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogo, false), child: const Text('Cancelar')),
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
      await SesionScope.de(context).api.delete('/api/activos/${widget.activoId}');
      if (mounted) Navigator.pop(context, true);
    } on ErrorApi catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.mensaje), backgroundColor: Tema.rojo));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (did, __) {
        if (!did) Navigator.pop(context, _cambiado);
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(_activo?.nombre ?? 'Activo'),
          actions: _activo == null
              ? null
              : [
                  IconButton(icon: const Icon(Icons.edit_outlined), onPressed: _editar),
                  IconButton(icon: const Icon(Icons.delete_outline), onPressed: _eliminar),
                ],
        ),
        body: _cargando
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar)
                : _cuerpo(_activo!),
      ),
    );
  }

  Widget _cuerpo(Activo a) {
    final api = SesionScope.de(context).api;
    final fmt = DateFormat('d MMM y, HH:mm', 'es');
    return ListView(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + margenSistema(context)),
      children: [
        if (a.foto != null)
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: Image.network(
              api.urlFotoActivo(a.id).toString(),
              headers: api.cabecerasAdjunto,
              height: 200,
              width: double.infinity,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => const SizedBox.shrink(),
            ),
          ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            Distintivo(texto: _estadosActivo[a.estado] ?? a.estado, color: _colorEstadoActivo(a.estado)),
            Distintivo(texto: a.grupoNombre, color: Tema.azul),
            Distintivo(texto: a.localNombre, color: Tema.gris),
          ],
        ),
        if (a.descripcion != null && a.descripcion!.isNotEmpty) ...[
          const SizedBox(height: 12),
          Text(a.descripcion!, style: const TextStyle(fontSize: 14)),
        ],
        const SizedBox(height: 20),
        const Text('Incidencias', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        if (a.incidencias.isEmpty)
          const Text('Sin incidencias registradas.', style: TextStyle(fontSize: 13, color: Tema.gris))
        else
          for (final t in a.incidencias)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Tarjeta(
                child: ListTile(
                  dense: true,
                  title: Text(t.titulo, style: const TextStyle(fontSize: 14)),
                  subtitle: Text(
                    t.creadoEn != null ? fmt.format(t.creadoEn!) : '',
                    style: const TextStyle(fontSize: 12, color: Tema.gris),
                  ),
                  trailing: DistintivoEstado(t.estado),
                ),
              ),
            ),
      ],
    );
  }
}

/// Alta o edición de un activo. La foto se sube al final, cuando ya existe el
/// activo: si es nuevo, primero se crea con sus datos y luego se le añade la
/// foto, igual que un adjunto no cuelga de nada hasta que la incidencia existe.
class EditarActivo extends StatefulWidget {
  const EditarActivo({super.key, this.activo});

  final Activo? activo;

  @override
  State<EditarActivo> createState() => _EditarActivoState();
}

class _EditarActivoState extends State<EditarActivo> {
  late final _nombre = TextEditingController(text: widget.activo?.nombre ?? '');
  late final _descripcion = TextEditingController(text: widget.activo?.descripcion ?? '');
  int? _grupoId;
  int? _localId;
  late String _estado = widget.activo?.estado ?? 'en_uso';
  String? _fotoNueva;
  bool _guardando = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _grupoId = widget.activo?.grupoId;
    _localId = widget.activo?.localId;
  }

  @override
  void dispose() {
    _nombre.dispose();
    _descripcion.dispose();
    super.dispose();
  }

  Future<void> _elegirFoto() async {
    final origen = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (hoja) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Hacer una foto'),
              onTap: () => Navigator.pop(hoja, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Elegir de la galería'),
              onTap: () => Navigator.pop(hoja, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (origen == null) return;
    final foto = await ImagePicker().pickImage(source: origen, maxWidth: 1600, imageQuality: 80);
    if (foto != null) setState(() => _fotoNueva = foto.path);
  }

  Future<void> _guardar() async {
    final nombre = _nombre.text.trim();
    if (nombre.isEmpty) {
      setState(() => _error = 'El nombre es obligatorio.');
      return;
    }
    if (_grupoId == null) {
      setState(() => _error = 'El departamento es obligatorio.');
      return;
    }
    if (_localId == null) {
      setState(() => _error = 'El local es obligatorio.');
      return;
    }

    setState(() {
      _guardando = true;
      _error = null;
    });
    try {
      final api = SesionScope.de(context).api;
      final cuerpo = {
        'nombre': nombre,
        'descripcion': _descripcion.text.trim(),
        'grupo_id': _grupoId,
        'local_id': _localId,
        'estado': _estado,
      };
      final id = widget.activo?.id;
      final activo = id == null ? await api.post('/api/activos', cuerpo) : await api.put('/api/activos/$id', cuerpo);
      if (_fotoNueva != null) {
        final activoId = (activo as Map)['id'] as int;
        final bytes = await File(_fotoNueva!).readAsBytes();
        await api.subirRaw('/api/activos/$activoId/foto', 'foto.jpg', bytes);
      }
      if (mounted) Navigator.pop(context, true);
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final meta = SesionScope.de(context).meta;
    final grupos = meta?.grupos ?? const <Catalogo>[];
    final locales = meta?.locales ?? const <Catalogo>[];

    return Scaffold(
      appBar: AppBar(title: Text(widget.activo == null ? 'Agregar activo' : 'Editar activo')),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + margenSistema(context)),
        children: [
          TextField(
            controller: _nombre,
            autofocus: widget.activo == null,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Nombre'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _descripcion,
            minLines: 2,
            maxLines: 4,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Descripción (opcional)'),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<int>(
            value: _grupoId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Departamento'),
            items: [for (final g in grupos) DropdownMenuItem(value: g.id, child: Text(g.nombre))],
            onChanged: (v) => setState(() => _grupoId = v),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<int>(
            value: _localId,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Local'),
            items: [for (final l in locales) DropdownMenuItem(value: l.id, child: Text(l.nombre))],
            onChanged: (v) => setState(() => _localId = v),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _estado,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Estado'),
            items: [for (final e in _estadosActivo.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
            onChanged: (v) => setState(() => _estado = v ?? _estado),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: _elegirFoto,
            icon: const Icon(Icons.camera_alt_outlined),
            label: Text(_fotoNueva != null
                ? 'Foto elegida'
                : (widget.activo?.foto != null ? 'Cambiar la foto' : 'Añadir una foto (opcional)')),
          ),
          if (_fotoNueva != null) ...[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.file(File(_fotoNueva!), height: 160, fit: BoxFit.cover),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(_error!, style: const TextStyle(color: Tema.rojo, fontSize: 13.5)),
          ],
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _guardando ? null : _guardar,
            child: _guardando
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
