import 'package:flutter/material.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';

/// Empresas con contrato de mantenimiento externo, con sus datos de
/// contacto. A diferencia de departamentos y locales (`Catalogos`), lleva más
/// que un nombre, así que tiene su propia pantalla y su propio formulario.
///
/// Solo para administradores. El servidor lo comprueba igualmente; esto es lo
/// que evita enseñar un botón que iba a responder 403.
class CatalogosEmpresas extends StatefulWidget {
  const CatalogosEmpresas({super.key});

  @override
  State<CatalogosEmpresas> createState() => _CatalogosEmpresasState();
}

class _CatalogosEmpresasState extends State<CatalogosEmpresas> {
  List<Empresa> _empresas = [];
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
      final datos = await SesionScope.de(context).api.get('/api/empresas') as List;
      if (!mounted) return;
      setState(() {
        _empresas = datos.map((e) => Empresa.desdeJson(e as Map<String, dynamic>)).toList();
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

  Future<void> _editar({Empresa? fila}) async {
    final datos = await showDialog<Map<String, String>>(
      context: context,
      builder: (_) => _DialogoEmpresa(empresa: fila),
    );
    if (datos == null || datos['nombre']!.trim().isEmpty || !mounted) return;

    try {
      final api = SesionScope.de(context).api;
      if (fila == null) {
        await api.post('/api/empresas', datos);
      } else {
        await api.put('/api/empresas/${fila.id}', datos);
      }
      await _cargar();
      // Los desplegables del programador de tareas tienen que enterarse.
      if (mounted) await SesionScope.de(context).refrescarMeta();
    } on ErrorApi catch (e) {
      _avisar(e.mensaje, error: true);
    }
  }

  Future<void> _borrar(Empresa fila) async {
    final seguro = await showDialog<bool>(
      context: context,
      builder: (dialogo) => AlertDialog(
        title: Text('Eliminar ${fila.nombre}'),
        content: const Text('¿Seguro que quieres eliminar esta empresa?'),
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
      await SesionScope.de(context).api.delete('/api/empresas/${fila.id}');
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
      appBar: AppBar(title: const Text('Empresas')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _editar(),
        icon: const Icon(Icons.add),
        label: const Text('Nueva'),
      ),
      body: RefreshIndicator(
        onRefresh: _cargar,
        child: _cargando && _empresas.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _empresas.isEmpty
                ? ListView(children: [
                    const SizedBox(height: 80),
                    Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar),
                  ])
                : _empresas.isEmpty
                    ? ListView(children: const [
                        SizedBox(height: 80),
                        Aviso(
                          icono: Icons.engineering_outlined,
                          texto: 'Sin empresas todavía. Agrega una con el botón de abajo.',
                        ),
                      ])
                    : ListView.separated(
                        padding: EdgeInsets.fromLTRB(12, 12, 12, 90 + margenSistema(context)),
                        itemCount: _empresas.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, i) => _tarjeta(_empresas[i]),
                      ),
      ),
    );
  }

  Widget _tarjeta(Empresa e) {
    final datos = [e.contacto, e.telefono, e.email].where((v) => v != null && v.isNotEmpty).join(' · ');
    return Tarjeta(
      child: ListTile(
        title: Text(e.nombre),
        subtitle: datos.isEmpty ? null : Text(datos, style: const TextStyle(fontSize: 12.5)),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: () => _editar(fila: e),
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 20, color: Tema.rojo),
              onPressed: () => _borrar(e),
            ),
          ],
        ),
      ),
    );
  }
}

/// Pide los datos de una empresa y los devuelve al cerrarse; nulo si se
/// cancela.
class _DialogoEmpresa extends StatefulWidget {
  const _DialogoEmpresa({this.empresa});

  final Empresa? empresa;

  @override
  State<_DialogoEmpresa> createState() => _DialogoEmpresaState();
}

class _DialogoEmpresaState extends State<_DialogoEmpresa> {
  late final _nombre = TextEditingController(text: widget.empresa?.nombre ?? '');
  late final _contacto = TextEditingController(text: widget.empresa?.contacto ?? '');
  late final _telefono = TextEditingController(text: widget.empresa?.telefono ?? '');
  late final _email = TextEditingController(text: widget.empresa?.email ?? '');
  late final _notas = TextEditingController(text: widget.empresa?.notas ?? '');

  @override
  void dispose() {
    _nombre.dispose();
    _contacto.dispose();
    _telefono.dispose();
    _email.dispose();
    _notas.dispose();
    super.dispose();
  }

  void _aceptar() => Navigator.pop(context, {
        'nombre': _nombre.text,
        'contacto': _contacto.text,
        'telefono': _telefono.text,
        'email': _email.text,
        'notas': _notas.text,
      });

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.empresa == null ? 'Nueva empresa' : 'Editar empresa'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _nombre,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Nombre'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _contacto,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Contacto'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _telefono,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Teléfono'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Correo'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _notas,
              minLines: 2,
              maxLines: 4,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Notas'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
        FilledButton(onPressed: _aceptar, child: const Text('Guardar')),
      ],
    );
  }
}
