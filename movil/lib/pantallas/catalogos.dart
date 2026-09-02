import 'package:flutter/material.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';

/// Departamentos, locales y prendas de lavandería: las tres son la misma
/// lista de «id y nombre», así que las atiende una sola pantalla.
/// «Departamento» es el nombre que ve el usuario; por dentro sigue siendo
/// «grupo», que es como lo llama el servidor (quién resuelve la incidencia,
/// no confundir con el «Grupo» de familias y subfamilias).
///
/// Solo para administradores. El servidor lo comprueba igualmente; esto es lo
/// que evita enseñar un botón que iba a responder 403.
enum TipoCatalogo { grupos, locales, prendas }

class Catalogos extends StatefulWidget {
  const Catalogos({super.key, required this.tipo});

  final TipoCatalogo tipo;

  @override
  State<Catalogos> createState() => _CatalogosState();
}

class _CatalogosState extends State<Catalogos> {
  List<Catalogo> _filas = [];
  bool _cargando = true;
  String? _error;
  bool _iniciado = false;

  String get _ruta => switch (widget.tipo) {
        TipoCatalogo.grupos => '/api/grupos',
        TipoCatalogo.locales => '/api/locales',
        TipoCatalogo.prendas => '/api/prendas-lavanderia',
      };
  String get _titulo => switch (widget.tipo) {
        TipoCatalogo.grupos => 'Departamentos',
        TipoCatalogo.locales => 'Locales',
        TipoCatalogo.prendas => 'Prendas',
      };
  String get _singular => switch (widget.tipo) {
        TipoCatalogo.grupos => 'departamento',
        TipoCatalogo.locales => 'local',
        TipoCatalogo.prendas => 'prenda',
      };

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
      final datos = await SesionScope.de(context).api.get(_ruta) as List;
      if (!mounted) return;
      setState(() {
        _filas = datos
            .map((e) => Catalogo.desdeJson(e as Map<String, dynamic>))
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

  Future<void> _editar({Catalogo? fila}) async {
    final nombre = await showDialog<String>(
      context: context,
      builder: (_) => _DialogoNombre(
        titulo: fila == null ? 'Nuevo $_singular' : 'Editar $_singular',
        inicial: fila?.nombre ?? '',
      ),
    );

    if (nombre == null || nombre.trim().isEmpty || !mounted) return;

    try {
      final api = SesionScope.de(context).api;
      if (fila == null) {
        await api.post(_ruta, {'nombre': nombre.trim()});
      } else {
        await api.put('$_ruta/${fila.id}', {'nombre': nombre.trim()});
      }
      await _cargar();
      // Los desplegables del resto de la app tienen que enterarse.
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _borrar(Catalogo fila) async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: Text('Eliminar ${fila.nombre}'),
        content: Text('¿Seguro que quieres eliminar este $_singular?'),
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
      await SesionScope.de(context).api.delete('$_ruta/${fila.id}');
      await _cargar();
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      // El servidor no deja borrar lo que está en uso, y explica por qué.
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
      appBar: AppBar(title: Text(_titulo)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _editar(),
        icon: const Icon(Icons.add),
        label: const Text('Nuevo'),
      ),
      body: RefreshIndicator(
        onRefresh: _cargar,
        child: _cargando && _filas.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _filas.isEmpty
                ? ListView(children: [
                    const SizedBox(height: 80),
                    Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar),
                  ])
                : ListView.separated(
                    padding: EdgeInsets.fromLTRB(12, 12, 12, 90 + margenSistema(context)),
                    itemCount: _filas.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (_, i) => Tarjeta(
                      child: ListTile(
                        title: Text(_filas[i].nombre),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              icon: const Icon(Icons.edit_outlined, size: 20),
                              onPressed: () => _editar(fila: _filas[i]),
                            ),
                            IconButton(
                              icon: const Icon(Icons.delete_outline,
                                  size: 20, color: Tema.rojo),
                              onPressed: () => _borrar(_filas[i]),
                            ),
                          ],
                        ),
                      ),
                    ),
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
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancelar'),
        ),
        FilledButton(onPressed: _aceptar, child: const Text('Guardar')),
      ],
    );
  }
}
