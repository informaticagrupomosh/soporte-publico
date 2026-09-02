import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../app.dart';
import '../modelos/modelos.dart';
import '../nucleo/api.dart';
import '../nucleo/tema.dart';
import '../widgets/etiquetas.dart';
import '../widgets/tarjeta.dart';

/// Incidencias entradas, resueltas y pendientes por local, con el reparto por
/// estado y las entradas por mes.
///
/// Quién ve qué lo decide el servidor: un técnico solo sus números, y el filtro
/// de técnico le viene fijado desde `/api/meta`, así que aquí ni se ofrece.
class Informes extends StatefulWidget {
  const Informes({super.key});

  @override
  State<Informes> createState() => _InformesState();
}

class _InformesState extends State<Informes> {
  Informe? _informe;
  bool _cargando = true;
  String? _error;
  bool _iniciado = false;

  int? _grupoId;
  int? _localId;
  int? _areaId;
  int? _familiaId;
  int? _subfamiliaId;
  int? _tecnicoId;

  // Por defecto, lo que va de año, que es el rango que se mira casi siempre.
  late DateTime _desde = DateTime(DateTime.now().year, 1, 1);
  late DateTime _hasta = DateTime.now();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_iniciado) return;
    _iniciado = true;
    // El técnico tiene sus informes fijados a sí mismo.
    _tecnicoId = SesionScope.de(context).meta?.tecnicoFijado;
    _cargar();
  }

  static String _dia(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

  Future<void> _cargar() async {
    setState(() => _cargando = true);
    // La sesión se lee antes de esperar, no después: el árbol puede haber
    // cambiado para cuando vuelva la respuesta.
    final sesion = SesionScope.de(context);
    try {
      final datos = await sesion.api.get('/api/informes', {
        'desde': _dia(_desde),
        'hasta': _dia(_hasta),
        'grupo_id': _grupoId,
        'local_id': _localId,
        'area_id': _areaId,
        'familia_id': _familiaId,
        'subfamilia_id': _subfamiliaId,
        'tecnico_id': _tecnicoId,
      });
      if (!mounted) return;
      final informe = Informe.desdeJson(datos as Map<String, dynamic>);
      setState(() {
        _informe = informe;
        _error = null;
        _cargando = false;
      });

      // El técnico elegido puede no atender el local que se acaba de elegir. Se
      // quita el filtro y se vuelve a pedir, en vez de enseñar unos números que
      // no son los suyos.
      final fijado = sesion.meta?.tecnicoFijado != null;
      if (!fijado &&
          _tecnicoId != null &&
          !informe.tecnicos.any((t) => t.id == _tecnicoId)) {
        setState(() => _tecnicoId = null);
        await _cargar();
      }
    } on ErrorApi catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.mensaje;
        _cargando = false;
      });
    }
  }

  Future<void> _elegirFecha({required bool inicio}) async {
    final elegida = await showDatePicker(
      context: context,
      initialDate: inicio ? _desde : _hasta,
      firstDate: DateTime(2020),
      lastDate: DateTime(DateTime.now().year + 1, 12, 31),
      locale: const Locale('es'),
    );
    if (elegida == null) return;
    setState(() {
      if (inicio) {
        _desde = elegida;
        // Un rango al revés no lo acepta el servidor; se corrige aquí.
        if (_desde.isAfter(_hasta)) _hasta = _desde;
      } else {
        _hasta = elegida;
        if (_hasta.isBefore(_desde)) _desde = _hasta;
      }
    });
    _cargar();
  }

  @override
  Widget build(BuildContext context) {
    final meta = SesionScope.de(context).meta;
    final fijado = meta?.tecnicoFijado != null;
    // La lavandería no es cosa del técnico: sin permiso, ni se le enseña la
    // pestaña, que es la misma regla que ya aplica el servidor al responder
    // el informe.
    final conLavanderia = meta?.puedeUsarLavanderia ?? false;

    return DefaultTabController(
      length: conLavanderia ? 2 : 1,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Informes'),
          actions: [
            IconButton(
              tooltip: 'Actualizar',
              onPressed: _cargar,
              icon: const Icon(Icons.refresh),
            ),
          ],
          bottom: TabBar(
            tabs: [
              const Tab(text: 'Mantenimiento'),
              if (conLavanderia) const Tab(text: 'Lavandería'),
            ],
          ),
        ),
        body: TabBarView(
          children: [
            _tabMantenimiento(meta, fijado),
            if (conLavanderia) _tabLavanderia(meta),
          ],
        ),
      ),
    );
  }

  Widget _tabMantenimiento(Meta? meta, bool fijado) {
    return RefreshIndicator(
      onRefresh: _cargar,
      child: ListView(
        padding: EdgeInsets.fromLTRB(12, 12, 12, 24 + margenSistema(context)),
        children: [
          _filtrosComunes(meta),
          const SizedBox(height: 12),
          _filtrosMantenimiento(meta, fijado),
          const SizedBox(height: 12),
          if (_cargando && _informe == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 60),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar)
          else if (_informe != null) ...[
            _resumen(_informe!),
            const SizedBox(height: 12),
            _porEstado(_informe!),
            const SizedBox(height: 12),
            _porLocal(_informe!),
            const SizedBox(height: 12),
            _porArea(_informe!),
            const SizedBox(height: 12),
            _porFamilia(_informe!),
            if (_informe!.meses.isNotEmpty) ...[
              const SizedBox(height: 12),
              _porMes(_informe!),
            ],
          ],
        ],
      ),
    );
  }

  Widget _tabLavanderia(Meta? meta) {
    return RefreshIndicator(
      onRefresh: _cargar,
      child: ListView(
        padding: EdgeInsets.fromLTRB(12, 12, 12, 24 + margenSistema(context)),
        children: [
          _filtrosComunes(meta),
          const SizedBox(height: 12),
          if (_cargando && _informe == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 60),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            Aviso(icono: Icons.cloud_off, texto: _error!, accion: _cargar)
          else if (_informe != null)
            _porLavanderia(_informe!),
        ],
      ),
    );
  }

  // Desde/Hasta y Local afectan por igual al mantenimiento y a la lavandería
  // —es la misma incidencia o el mismo envío el que cae dentro o fuera del
  // rango—, así que este filtro se enseña en las dos pestañas.
  Widget _filtrosComunes(Meta? meta) {
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: _fecha('Desde', _desde, () => _elegirFecha(inicio: true))),
                const SizedBox(width: 10),
                Expanded(child: _fecha('Hasta', _hasta, () => _elegirFecha(inicio: false))),
              ],
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
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
          ],
        ),
      ),
    );
  }

  // El resto de filtros solo afectan a las incidencias, no a la lavandería:
  // se quedan en la pestaña de mantenimiento.
  Widget _filtrosMantenimiento(Meta? meta, bool fijado) {
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            DropdownButtonFormField<int>(
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
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              value: _areaId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Grupo', isDense: true),
              items: [
                const DropdownMenuItem(value: null, child: Text('Todos')),
                for (final a in meta?.areas ?? const <Catalogo>[])
                  DropdownMenuItem(value: a.id, child: Text(a.nombre)),
              ],
              // La familia y la subfamilia elegidas eran del grupo anterior:
              // se limpian con él.
              onChanged: (v) {
                setState(() {
                  _areaId = v;
                  _familiaId = null;
                  _subfamiliaId = null;
                });
                _cargar();
              },
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
              // La subfamilia elegida era de la familia anterior: se limpia con ella.
              onChanged: (v) {
                setState(() {
                  _familiaId = v;
                  _subfamiliaId = null;
                });
                _cargar();
              },
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<int>(
              value: _subfamiliaId,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Subfamilia', isDense: true),
              items: [
                const DropdownMenuItem(value: null, child: Text('Todas')),
                for (final s in (meta?.subfamilias ?? const <Subfamilia>[])
                    .where((s) => s.familiaId == _familiaId))
                  DropdownMenuItem(value: s.id, child: Text(s.nombre)),
              ],
              onChanged: (v) {
                setState(() => _subfamiliaId = v);
                _cargar();
              },
            ),
            const SizedBox(height: 12),
            // «Gestionada por» es quien tiene la incidencia asignada. Al técnico
            // se le fija a sí mismo y no puede cambiarlo.
            DropdownButtonFormField<int>(
              value: _tecnicoId,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: 'Gestionada por',
                isDense: true,
                helperText: fijado ? 'Tus incidencias' : null,
              ),
              // La lista la recorta el servidor con cada consulta, según el
              // grupo y el local elegidos: no tiene sentido ofrecer a un
              // técnico que no atiende ese local. Hasta que llega el primer
              // informe se usa la de `/api/meta`.
              items: [
                if (!fijado) const DropdownMenuItem(value: null, child: Text('Todos')),
                for (final t in _tecnicosDisponibles(meta))
                  DropdownMenuItem(value: t.id, child: Text(t.nombre)),
              ],
              onChanged: fijado
                  ? null
                  : (v) {
                      setState(() => _tecnicoId = v);
                      _cargar();
                    },
            ),
          ],
        ),
      ),
    );
  }

  /// Quién puede elegirse en «gestionada por» ahora mismo.
  List<Catalogo> _tecnicosDisponibles(Meta? meta) =>
      _informe?.tecnicos ?? meta?.tecnicosInformes ?? const <Catalogo>[];

  Widget _fecha(String etiqueta, DateTime valor, VoidCallback alPulsar) {
    return InkWell(
      onTap: alPulsar,
      borderRadius: BorderRadius.circular(8),
      child: InputDecorator(
        decoration: InputDecoration(labelText: etiqueta, isDense: true),
        child: Text(
          DateFormat('d MMM y', 'es').format(valor),
          style: const TextStyle(fontSize: 14),
        ),
      ),
    );
  }

  Widget _resumen(Informe i) {
    return Row(
      children: [
        Expanded(child: _cifra('Entradas', i.entrados, Tema.azul)),
        const SizedBox(width: 10),
        Expanded(child: _cifra('Resueltas', i.resueltos, Tema.verde)),
        const SizedBox(width: 10),
        Expanded(child: _cifra('Pendientes', i.sinCerrar, Tema.ambar)),
      ],
    );
  }

  Widget _cifra(String etiqueta, int valor, Color color) {
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
        child: Column(
          children: [
            Text(
              '$valor',
              style: TextStyle(fontSize: 26, fontWeight: FontWeight.w600, color: color),
            ),
            const SizedBox(height: 2),
            Text(
              etiqueta,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 11.5, color: Tema.gris),
            ),
          ],
        ),
      ),
    );
  }

  /// En qué estado están ahora mismo las incidencias que entraron en el rango.
  Widget _porEstado(Informe i) {
    final total = i.abiertas + i.pendientes + i.cerradas;
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('En qué estado están',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            if (total == 0)
              const Text('Sin incidencias en este rango.',
                  style: TextStyle(color: Tema.gris, fontSize: 13))
            else ...[
              _barra('Abiertas', i.abiertas, total, Tema.azul),
              _barra('Pendientes', i.pendientes, total, Tema.ambar),
              _barra('Cerradas', i.cerradas, total, Tema.verde),
            ],
          ],
        ),
      ),
    );
  }

  Widget _barra(String etiqueta, int valor, int total, Color color) {
    final parte = total == 0 ? 0.0 : valor / total;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(etiqueta, style: const TextStyle(fontSize: 13))),
              Text(
                '$valor',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: color),
              ),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: parte,
              minHeight: 7,
              backgroundColor: Tema.grisClaro,
              valueColor: AlwaysStoppedAnimation(color),
            ),
          ),
        ],
      ),
    );
  }

  Widget _porLocal(Informe i) {
    final conAlgo = i.locales.where((l) => l.entrados > 0 || l.resueltos > 0).toList();
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Por local',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            if (conAlgo.isEmpty)
              const Text('Sin incidencias en este rango.',
                  style: TextStyle(color: Tema.gris, fontSize: 13))
            else
              // Una tabla estrecha se lee mal en un móvil: cada local es una
              // fila con sus tres cifras separadas.
              for (final l in conAlgo)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(l.nombre, style: const TextStyle(fontSize: 13.5)),
                      ),
                      _cifrita(l.entrados, Tema.azul),
                      _cifrita(l.resueltos, Tema.verde),
                      _cifrita(l.pendientes, Tema.ambar),
                    ],
                  ),
                ),
            if (conAlgo.isNotEmpty) ...[
              const Divider(height: 20),
              Row(
                children: const [
                  Expanded(child: SizedBox()),
                  _Leyenda('Entr.', Tema.azul),
                  _Leyenda('Resu.', Tema.verde),
                  _Leyenda('Pend.', Tema.ambar),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Mismo desglose que `_porLocal`, por grupo. Solo entran las incidencias
  /// categorizadas: las que no tienen grupo no aparecen en ningún reparto.
  Widget _porArea(Informe i) {
    final conAlgo = i.areas.where((a) => a.entrados > 0 || a.resueltos > 0).toList();
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Por grupo',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            if (conAlgo.isEmpty)
              const Text('Sin incidencias categorizadas en este rango.',
                  style: TextStyle(color: Tema.gris, fontSize: 13))
            else
              for (final a in conAlgo)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(a.nombre, style: const TextStyle(fontSize: 13.5)),
                      ),
                      _cifrita(a.entrados, Tema.azul),
                      _cifrita(a.resueltos, Tema.verde),
                      _cifrita(a.pendientes, Tema.ambar),
                    ],
                  ),
                ),
            if (conAlgo.isNotEmpty) ...[
              const Divider(height: 20),
              Row(
                children: const [
                  Expanded(child: SizedBox()),
                  _Leyenda('Entr.', Tema.azul),
                  _Leyenda('Resu.', Tema.verde),
                  _Leyenda('Pend.', Tema.ambar),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Mismo desglose que `_porLocal`, por familia. Solo entran las incidencias
  /// categorizadas: las que no tienen familia no aparecen en ningún reparto.
  Widget _porFamilia(Informe i) {
    final conAlgo = i.familias.where((f) => f.entrados > 0 || f.resueltos > 0).toList();
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Por familia',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            if (conAlgo.isEmpty)
              const Text('Sin incidencias categorizadas en este rango.',
                  style: TextStyle(color: Tema.gris, fontSize: 13))
            else
              for (final f in conAlgo)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(f.nombre, style: const TextStyle(fontSize: 13.5)),
                      ),
                      _cifrita(f.entrados, Tema.azul),
                      _cifrita(f.resueltos, Tema.verde),
                      _cifrita(f.pendientes, Tema.ambar),
                    ],
                  ),
                ),
            if (conAlgo.isNotEmpty) ...[
              const Divider(height: 20),
              Row(
                children: const [
                  Expanded(child: SizedBox()),
                  _Leyenda('Entr.', Tema.azul),
                  _Leyenda('Resu.', Tema.verde),
                  _Leyenda('Pend.', Tema.ambar),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// Enviado y recibido por prenda, con la merma aparte: no es una cuarta
  /// columna igual que las demás, solo interesa cuando es mayor que cero.
  Widget _porLavanderia(Informe i) {
    final conAlgo = i.lavanderia.where((p) => p.enviado > 0).toList();
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Lavandería',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 10),
            if (conAlgo.isEmpty)
              const Text('Sin envíos a lavandería en este rango.',
                  style: TextStyle(color: Tema.gris, fontSize: 13))
            else
              for (final p in conAlgo)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(p.nombre, style: const TextStyle(fontSize: 13.5)),
                      ),
                      _cifrita(p.enviado, Tema.azul),
                      _cifrita(p.recibido, Tema.verde),
                      _cifrita(p.merma, p.merma > 0 ? Tema.rojo : Tema.gris),
                    ],
                  ),
                ),
            if (conAlgo.isNotEmpty) ...[
              const Divider(height: 20),
              Row(
                children: const [
                  Expanded(child: SizedBox()),
                  _Leyenda('Env.', Tema.azul),
                  _Leyenda('Rec.', Tema.verde),
                  _Leyenda('Merma', Tema.rojo),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _cifrita(int valor, Color color) {
    return SizedBox(
      width: 44,
      child: Text(
        '$valor',
        textAlign: TextAlign.center,
        style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }

  Widget _porMes(Informe i) {
    final tope = i.meses.fold<int>(1, (a, e) => e.value > a ? e.value : a);
    return Tarjeta(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Entradas por mes',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            for (final m in i.meses)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    SizedBox(
                      width: 62,
                      child: Text(_mesLegible(m.key),
                          style: const TextStyle(fontSize: 12, color: Tema.gris)),
                    ),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: m.value / tope,
                          minHeight: 14,
                          backgroundColor: Tema.grisClaro,
                          valueColor: const AlwaysStoppedAnimation(Tema.azul),
                        ),
                      ),
                    ),
                    SizedBox(
                      width: 34,
                      child: Text(
                        '${m.value}',
                        textAlign: TextAlign.right,
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// «2026-08» → «ago 2026».
  String _mesLegible(String clave) {
    final partes = clave.split('-');
    if (partes.length != 2) return clave;
    final anio = int.tryParse(partes[0]);
    final mes = int.tryParse(partes[1]);
    if (anio == null || mes == null) return clave;
    return DateFormat('MMM y', 'es').format(DateTime(anio, mes));
  }
}

class _Leyenda extends StatelessWidget {
  const _Leyenda(this.texto, this.color);

  final String texto;
  final Color color;

  @override
  Widget build(BuildContext context) => SizedBox(
        width: 44,
        child: Text(
          texto,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 10.5, color: color, fontWeight: FontWeight.w600),
        ),
      );
}
