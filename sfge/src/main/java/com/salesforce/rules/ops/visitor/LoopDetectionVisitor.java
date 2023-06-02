package com.salesforce.rules.ops.visitor;

import com.salesforce.graph.build.StaticBlockUtil;
import com.salesforce.graph.symbols.SymbolProvider;
import com.salesforce.graph.vertex.*;
import com.salesforce.graph.visitor.DefaultNoOpPathVertexVisitor;
import com.salesforce.rules.ops.boundary.LoopBoundary;
import com.salesforce.rules.ops.boundary.LoopBoundaryDetector;
import com.salesforce.rules.ops.boundary.OverridableLoopExclusionBoundary;
import com.salesforce.rules.ops.boundary.PermanentLoopExclusionBoundary;
import java.util.Optional;

/** Visitor that gets notified when a loop vertex is invoked in the path. */
public abstract class LoopDetectionVisitor extends DefaultNoOpPathVertexVisitor {
    private final LoopBoundaryDetector loopBoundaryDetector;

    public LoopDetectionVisitor() {
        loopBoundaryDetector = new LoopBoundaryDetector();
    }

    @Override
    public boolean visit(DoLoopStatementVertex vertex, SymbolProvider symbols) {
        loopBoundaryDetector.pushBoundary(new LoopBoundary(vertex));
        return true;
    }

    @Override
    public void afterVisit(DoLoopStatementVertex vertex, SymbolProvider symbols) {
        loopBoundaryDetector.popBoundary(vertex);
    }

    @Override
    public boolean visit(ForEachStatementVertex vertex, SymbolProvider symbols) {
        loopBoundaryDetector.pushBoundary(new LoopBoundary(vertex));
        return true;
    }

    @Override
    public void afterVisit(ForEachStatementVertex vertex, SymbolProvider symbols) {
        loopBoundaryDetector.popBoundary(vertex);
    }

    @Override
    public boolean visit(ForLoopStatementVertex vertex, SymbolProvider symbols) {
        loopBoundaryDetector.pushBoundary(new LoopBoundary(vertex));
        return true;
    }

    @Override
    public void afterVisit(ForLoopStatementVertex vertex, SymbolProvider symbols) {
        loopBoundaryDetector.popBoundary(vertex);
    }

    @Override
    public boolean visit(WhileLoopStatementVertex vertex, SymbolProvider symbols) {
        loopBoundaryDetector.pushBoundary(new LoopBoundary(vertex));
        return true;
    }

    @Override
    public void afterVisit(WhileLoopStatementVertex vertex, SymbolProvider symbols) {
        loopBoundaryDetector.popBoundary(vertex);
    }

    /**
     * This case is specific to method calls on ForEach loop definition. These methods are called
     * only once even though they are technically under a loop definition. We create this boundary
     * to show that calls here are not actually called multiple times.
     *
     * <p>For example, <code>getValues()</code> in this forEach gets called only once: <code>
     * for (String s: getValues())</code>
     *
     * @param vertex Method call in question
     * @param symbols SymbolProvider at this state
     * @return true to visit the children
     */
    @Override
    public boolean visit(MethodCallExpressionVertex vertex, SymbolProvider symbols) {
        // If already within a loop's boundary, get the loop item
        final Optional<LoopBoundary> currentLoopBoundaryOpt = loopBoundaryDetector.peek();
        if (currentLoopBoundaryOpt.isPresent()) {
            final SFVertex loopBoundaryItem = currentLoopBoundaryOpt.get().getBoundaryItem();
            createPermanentLoopExclusionIfApplicable(vertex, loopBoundaryItem);
            createOverridableLoopExclusionIfApplicable(vertex, loopBoundaryItem);
        }
        return true;
    }

    private void createPermanentLoopExclusionIfApplicable(
            MethodCallExpressionVertex vertex, SFVertex loopBoundaryItem) {
        if (StaticBlockUtil.isStaticBlockMethodCall(vertex)) {
            // All nested loops before this don't get counted as a loop context.
            loopBoundaryDetector.pushBoundary(new PermanentLoopExclusionBoundary(vertex));
        }
    }

    private void createOverridableLoopExclusionIfApplicable(
            MethodCallExpressionVertex vertex, SFVertex loopBoundaryItem) {
        if (loopBoundaryItem instanceof ForEachStatementVertex) {
            // We are within a ForEach statement.
            // Check if the method calls parent is the same as this ForEach statement.
            // If they are the same, this method would get invoked only once.
            BaseSFVertex parentVertex = vertex.getParent();
            if (parentVertex instanceof ForEachStatementVertex
                    && parentVertex.equals(loopBoundaryItem)) {
                // This method would get invoked only once within the immediate surrounding loop
                // context
                loopBoundaryDetector.pushBoundary(new OverridableLoopExclusionBoundary(vertex));
            }
        }
    }

    @Override
    public void afterVisit(MethodCallExpressionVertex vertex, SymbolProvider symbols) {
        // If within a method call loop exclusion, pop boundary here.
        final Optional<LoopBoundary> currentLoopBoundaryOpt = loopBoundaryDetector.peek();
        if (currentLoopBoundaryOpt.isPresent()) {
            final LoopBoundary loopBoundary = currentLoopBoundaryOpt.get();
            if (loopBoundary instanceof OverridableLoopExclusionBoundary
                    || loopBoundary instanceof PermanentLoopExclusionBoundary) {
                // We are in exclusion zone. Check if the method call on the loop exclusion boundary
                // is the same as the current method call.
                if (vertex.equals(loopBoundary.getBoundaryItem())) {
                    // Pop the method call
                    loopBoundaryDetector.popBoundary(vertex);
                }
            }
        }
    }

    protected Optional<? extends SFVertex> isInsideLoop() {
        return loopBoundaryDetector.isInsideLoop();
    }
}
