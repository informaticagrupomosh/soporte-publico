import 'package:flutter/material.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';

/// Grupos, familias y subfamilias: la categoría de la avería, en tres
/// niveles. Cada familia cuelga de un grupo y cada subfamilia de una
/// familia, así que la pantalla las agrupa así, a diferencia de los
/// departamentos y los locales (`Catalogos`), que son listas planas.
///
/// Solo para administradores. El servidor lo comprueba igualmente; esto es lo
/// que evita enseñar un botón que iba a responder 403.
class CatalogosFamilias extends StatefulWidget {
  const CatalogosFamilias({super.key});

  @override
  State<CatalogosFamilias> createState() => _CatalogosFamiliasState();
}

class _CatalogosFamiliasState extends State<CatalogosFamilias> {
  List<Catalogo> _areas = [];
  List<Familia> _familias = [];
  List<Subfamilia> _subfamilias = [];
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
      final api = SesionScope.de(context).api;
      final areas = await api.get('/api/areas') as List;
      final familias = await api.get('/api/familias') as List;
      final subfamilias = await api.get('/api/subfamilias') as List;
      if (!mounted) return;
      setState(() {
        _areas = areas.map((e) => Catalogo.desdeJson(e as Map<String, dynamic>)).toList();
        _familias = familias.map((e) => Familia.desdeJson(e as Map<String, dynamic>)).toList();
        _subfamilias =
            subfamilias.map((e) => Subfamilia.desdeJson(e as Map<String, dynamic>)).toList();
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

  List<Familia> _familiasDe(int areaId) => _familias.where((f) => f.areaId == areaId).toList();

  List<Subfamilia> _subfamiliasDe(int familiaId) =>
      _subfamilias.where((s) => s.familiaId == familiaId).toList();

  Future<void> _editarArea({Catalogo? fila}) async {
    final nombre = await showDialog<String>(
      context: context,
      builder: (_) => _DialogoNombre(
        titulo: fila == null ? 'Nuevo grupo' : 'Editar grupo',
        inicial: fila?.nombre ?? '',
      ),
    );
    if (nombre == null || nombre.trim().isEmpty || !mounted) return;

    try {
      final api = SesionScope.de(context).api;
      if (fila == null) {
        await api.post('/api/areas', {'nombre': nombre.trim()});
      } else {
        await api.put('/api/areas/${fila.id}', {'nombre': nombre.trim()});
      }
      await _cargar();
      // Los desplegables del resto de la app tienen que enterarse.
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _borrarArea(Catalogo fila) async {
    if (!await _confirmar('Eliminar ${fila.nombre}', '¿Seguro que quieres eliminar este grupo?')) {
      return;
    }
    try {
      await SesionScope.de(context).api.delete('/api/areas/${fila.id}');
      await _cargar();
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      // El servidor no deja borrar lo que está en uso, y explica por qué.
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _nuevaFamilia(Catalogo area) async {
    final nombre = await showDialog<String>(
      context: context,
      builder: (_) => const _DialogoNombre(titulo: 'Nueva familia', inicial: ''),
    );
    if (nombre == null || nombre.trim().isEmpty || !mounted) return;

    try {
      await SesionScope.de(context).api.post('/api/familias', {
        'nombre': nombre.trim(),
        'area_id': area.id,
      });
      await _cargar();
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _editarFamilia(Familia fila) async {
    final nombre = await showDialog<String>(
      context: context,
      builder: (_) => _DialogoNombre(titulo: 'Editar familia', inicial: fila.nombre),
    );
    if (nombre == null || nombre.trim().isEmpty || !mounted) return;

    try {
      final api = SesionScope.de(context).api;
      await api.put('/api/familias/${fila.id}', {'nombre': nombre.trim()});
      await _cargar();
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _borrarFamilia(Familia fila) async {
    if (!await _confirmar('Eliminar ${fila.nombre}', '¿Seguro que quieres eliminar esta familia?')) {
      return;
    }
    try {
      await SesionScope.de(context).api.delete('/api/familias/${fila.id}');
      await _cargar();
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _nuevaSubfamilia(Familia familia) async {
    final nombre = await showDialog<String>(
      context: context,
      builder: (_) => const _DialogoNombre(titulo: 'Nueva subfamilia', inicial: ''),
    );
    if (nombre == null || nombre.trim().isEmpty || !mounted) return;

    try {
      await SesionScope.de(context).api.post('/api/subfamilias', {
        'nombre': nombre.trim(),
        'familia_id': familia.id,
      });
      await _cargar();
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _editarSubfamilia(Subfamilia fila) async {
    final nombre = await showDialog<String>(
      context: context,
      builder: (_) => _DialogoNombre(titulo: 'Editar subfamilia', inicial: fila.nombre),
    );
    if (nombre == null || nombre.trim().isEmpty || !mounted) return;

    try {
      await SesionScope.de(context).api.put('/api/subfamilias/${fila.id}', {'nombre': nombre.trim()});
      await _cargar();
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _borrarSubfamilia(Subfamilia fila) async {
    if (!await _confirmar('Eliminar ${fila.nombre}', '¿Seguro que quieres eliminar esta subfamilia?')) {
      return;
    }
    try {
      await SesionScope.de(context).api.delete('/api/subfamilias/${fila.id}');
      await _cargar();
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<bool> _confirmar(String titulo, String mensaje) async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: Text(titulo),
        content: Text(mensaje),
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
    return seguro == true && mounted;
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
      appBar: AppBar(title: const Text('Grupos y familias')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _editarArea(),
        icon: const Icon(Icons.add),
        label: const Text('Nuevo grupo'),
      ),
      body: RefreshIndicator(
        onRefresh: _cargar,
        child: _cargando && _areas.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _areas.isEmpty
                ? ListView(children: [
                    const SizedBox(height: 80),
                    Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar),
                  ])
                : _areas.isEmpty
                    ? ListView(children: const [
                        SizedBox(height: 80),
                        Aviso(
                          icono: Icons.widgets_outlined,
                          texto: 'Sin grupos todavía. Agrega uno con el botón de abajo.',
                        ),
                      ])
                    : ListView.separated(
                        padding: EdgeInsets.fromLTRB(12, 12, 12, 90 + margenSistema(context)),
                        itemCount: _areas.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => _tarjetaArea(_areas[i]),
                      ),
      ),
    );
  }

  Widget _tarjetaArea(Catalogo area) {
    final familias = _familiasDe(area.id);
    return Tarjeta(
      recortar: true,
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          title: Text(area.nombre),
          subtitle: Text(
            familias.isEmpty ? 'Sin familias' : '${familias.length} familia(s)',
            style: const TextStyle(fontSize: 12, color: Tema.gris),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                icon: const Icon(Icons.edit_outlined, size: 20),
                onPressed: () => _editarArea(fila: area),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 20, color: Tema.rojo),
                onPressed: () => _borrarArea(area),
              ),
            ],
          ),
          children: [
            for (final f in familias) _tarjetaFamilia(f),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => _nuevaFamilia(area),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Agregar familia'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _tarjetaFamilia(Familia familia) {
    final subfamilias = _subfamiliasDe(familia.id);
    return Padding(
      padding: const EdgeInsets.only(left: 12),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          title: Text(familia.nombre),
          subtitle: Text(
            subfamilias.isEmpty ? 'Sin subfamilias' : '${subfamilias.length} subfamilia(s)',
            style: const TextStyle(fontSize: 12, color: Tema.gris),
          ),
          trailing: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                icon: const Icon(Icons.edit_outlined, size: 20),
                onPressed: () => _editarFamilia(familia),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, size: 20, color: Tema.rojo),
                onPressed: () => _borrarFamilia(familia),
              ),
            ],
          ),
          children: [
            for (final s in subfamilias)
              ListTile(
                contentPadding: const EdgeInsets.only(left: 32, right: 8),
                title: Text(s.nombre),
                trailing: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.edit_outlined, size: 20),
                      onPressed: () => _editarSubfamilia(s),
                    ),
                    IconButton(
                      icon: const Icon(Icons.delete_outline, size: 20, color: Tema.rojo),
                      onPressed: () => _borrarSubfamilia(s),
                    ),
                  ],
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => _nuevaSubfamilia(familia),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Agregar subfamilia'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Pide un nombre y lo devuelve al cerrarse; nulo si se cancela.
///
/// Tiene estado propio para poder quedarse con su `TextEditingController`
/// hasta que el diálogo se ha ido del todo. Creándolo fuera y soltándolo
/// nada más volver de `showDialog` se soltaba demasiado pronto: la ventana
/// todavía se está cerrando con su animación, el campo de texto sigue montado
/// y usándolo, y Flutter aborta al desmontarlo.
class _DialogoNombre extends StatefulWidget {
  const _DialogoNombre({required this.titulo, required this.inicial});

  final String titulo;
  final String inicial;

  @override
  State<_DialogoNombre> createState() => _DialogoNombreState();
}

class _DialogoNombreState extends State<_DialogoNombre> {
  late final _control = TextEditingController(text: widget.inicial);

  @override
  void dispose() {
    _control.dispose();
    super.dispose();
  }

  void _aceptar() => Navigator.pop(context, _control.text);

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.titulo),
      content: TextField(
        controller: _control,
        autofocus: true,
        textCapitalization: TextCapitalization.sentences,
        decoration: const InputDecoration(labelText: 'Nombre'),
        onSubmitted: (_) => _aceptar(),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        FilledButton(onPressed: _aceptar, child: const Text('Guardar')),
      ],
    );
  }
}
