import asyncio
from orchestrator.protos import orchestrator_pb2, orchestrator_pb2_grpc
from orchestrator.registry import ModuleRegistry

class OrchestratorServicer(orchestrator_pb2_grpc.OrchestratorServiceServicer):
    def __init__(self, registry: ModuleRegistry):
        self.registry = registry

    async def Health(self, request, context):
        return orchestrator_pb2.HealthCheckResponse(ok=True)

    async def ListModules(self, request, context):
        names = [mod.name for mod in self.registry.all()]
        return orchestrator_pb2.ModuleList(names=names)

    async def StartModule(self, request, context):
        for mod in self.registry.all():
            if mod.name == request.name:
                await mod.start()
                return orchestrator_pb2.ModuleResponse(name=request.name, status="started")
        context.set_code(grpc.StatusCode.NOT_FOUND)
        context.set_details("Module not found")
        return orchestrator_pb2.ModuleResponse(name=request.name, status="error")

    async def StopModule(self, request, context):
        for mod in self.registry.all():
            if mod.name == request.name:
                await mod.stop()
                return orchestrator_pb2.ModuleResponse(name=request.name, status="stopped")
        context.set_code(grpc.StatusCode.NOT_FOUND)
        context.set_details("Module not found")
        return orchestrator_pb2.ModuleResponse(name=request.name, status="error")
